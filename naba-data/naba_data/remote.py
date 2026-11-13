"""Remote HDF5 access: open over HTTPS, read only the AOI window, cache the result.

A port of notebook Sections 5 and 6. The important properties are preserved:

- opening a product reads only its metadata pages, not pixels;
- a window read fetches only the HDF5 chunks that overlap the AOI (HTTP range requests);
- every read is budgeted (`MAX_READ_MB`) and logged in megabytes;
- every subset is cached as a GeoTIFF, so a second run moves no bytes at all.
"""
from __future__ import annotations

import hashlib
import io
import logging
import re
from pathlib import Path

import numpy as np
import pandas as pd
import rasterio
import xarray as xr
from pyproj import CRS, Transformer
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

from . import auth
from .config import CACHE_DIR, FREQUENCY, GCOV_RES_DEG, HTTP_BLOCK_MB, MAX_READ_MB
from .ledger import log_op, timer

log = logging.getLogger("naba_data")


class ReadBudgetError(RuntimeError):
    """Raised when a window read would exceed MAX_READ_MB."""


class CountingFile(io.RawIOBase):
    """File wrapper that counts the bytes h5py asks for, so each read can report its cost."""

    def __init__(self, f):
        self.f, self.nread = f, 0

    def readable(self):
        return True

    def seekable(self):
        return True

    def seek(self, off, whence=0):
        return self.f.seek(off, whence)

    def tell(self):
        return self.f.tell()

    def readinto(self, b):
        data = self.f.read(len(b))
        n = len(data)
        b[:n] = data
        self.nread += n
        return n

    def close(self):
        try:
            self.f.close()
        finally:
            super().close()


class RemoteH5:
    """An open (remote or local) HDF5 product plus byte accounting."""

    def __init__(self, url, h5, raw, counter):
        self.url, self.h5, self.raw, self.counter = url, h5, raw, counter
        self.name = Path(str(url).split("?")[0]).name

    def network_bytes(self) -> int:
        cache = getattr(self.raw, "cache", None)
        total = getattr(cache, "total_requested_bytes", None)
        if total:
            return int(total)
        miss, bs = getattr(cache, "miss_count", None), getattr(cache, "blocksize", None)
        if miss is not None and bs:
            return int(miss * bs)
        return self.counter.nread      # local file: bytes read from disk

    def close(self):
        try:
            self.h5.close()
            self.counter.close()
        except Exception:
            pass


OPEN_FILES: dict[str, RemoteH5] = {}


def open_remote(url, block_mb: int = HTTP_BLOCK_MB) -> RemoteH5:
    """Open an HDF5 product over HTTPS (range requests) or from a local path. Metadata only."""
    import h5py

    key = str(url)
    if key in OPEN_FILES:
        return OPEN_FILES[key]
    with timer() as t:
        if key.startswith("http"):
            raw = auth.https_fs().open(key, mode="rb", cache_type="blockcache",
                                       block_size=block_mb * 2 ** 20)
        else:
            raw = open(key, "rb")
        cf = CountingFile(raw)
        try:    # the page buffer helps with NISAR's paged-aggregation files
            h5 = h5py.File(cf, "r", page_buf_size=16 * 2 ** 20, rdcc_nbytes=4 * 2 ** 20)
        except Exception:
            cf.seek(0)
            h5 = h5py.File(cf, "r", rdcc_nbytes=4 * 2 ** 20)
    rh = RemoteH5(key, h5, raw, cf)
    OPEN_FILES[key] = rh
    log_op("REMOTE" if key.startswith("http") else "LOCAL", rh.name, rh.network_bytes(),
           t["seconds"], "opened: metadata pages only")
    return rh


def close_all() -> None:
    for rh in OPEN_FILES.values():
        rh.close()
    OPEN_FILES.clear()


def find_datasets(h5, pattern: str) -> list[str]:
    """All dataset paths matching a regex, searched over the whole file tree."""
    import h5py

    rx, out = re.compile(pattern), []

    def visit(name, obj):
        if isinstance(obj, h5py.Dataset) and rx.search("/" + name):
            out.append("/" + name)

    h5.visititems(visit)
    return out


def resolve_var(rh: RemoteH5, var: str, frequency: str = FREQUENCY) -> str:
    """Turn a short name such as 'HHHH' into a full dataset path inside the product.

    Datasets under the requested frequency group win. The fallback searches the whole file (GUNW
    layers such as unwrappedPhase do not live under a frequency group) but says so loudly: a
    silent fallback would mean asking for frequency B's 80 m grid and quietly reading frequency
    A's 20 m grid instead - a wrong answer that looks right.
    """
    hits = find_datasets(rh.h5, rf"/frequency{frequency}/(.*/)?{var}$")
    if not hits:
        hits = find_datasets(rh.h5, rf"{var}$")
        if hits:
            log.warning("%r is not under /frequency%s in %s; using %s instead",
                        var, frequency, rh.name, hits[0])
    if not hits:
        raise KeyError(f"{var!r} not found in {rh.name}")
    if len(hits) > 1:
        log.debug("%r matched %d datasets; using %s", var, len(hits), hits[0])
    return hits[0]


def _find_up(h5, start_group: str, name: str):
    g = start_group
    while True:
        cand = f"{g.rstrip('/')}/{name}" if g else f"/{name}"
        if cand in h5:
            return cand
        if g in ("", "/"):
            return None
        g = g.rsplit("/", 1)[0]


def grid_info(rh: RemoteH5, ds_path: str):
    """x/y coordinate vectors and CRS for a gridded dataset."""
    import h5py  # noqa: F401  (kept for parity with the notebook's imports)

    h5, grp = rh.h5, ds_path.rsplit("/", 1)[0]
    xp, yp = _find_up(h5, grp, "xCoordinates"), _find_up(h5, grp, "yCoordinates")
    if not xp or not yp:
        raise KeyError(f"No xCoordinates/yCoordinates found above {ds_path}")
    x, y = h5[xp][()].astype("float64"), h5[yp][()].astype("float64")
    crs = None
    cands = []
    gm = h5[ds_path].attrs.get("grid_mapping")
    if gm is not None:
        gm = gm.decode() if isinstance(gm, bytes) else str(gm)
        cands.append(gm if gm.startswith("/") else f"{grp}/{gm}")
    pp = _find_up(h5, grp, "projection")
    if pp:
        cands.append(pp)
    for c in cands:
        if c in h5:
            a = h5[c].attrs
            for key in ("epsg_code", "epsg"):
                if key in a:
                    crs = CRS.from_epsg(int(np.atleast_1d(a[key])[0]))
                    break
            if crs is None:
                for key in ("spatial_ref", "crs_wkt"):
                    if key in a:
                        v = a[key]
                        crs = CRS.from_wkt(v.decode() if isinstance(v, bytes) else str(v))
                        break
            if crs is None and h5[c].shape == () and np.issubdtype(h5[c].dtype, np.integer):
                crs = CRS.from_epsg(int(h5[c][()]))
        if crs is not None:
            break
    if crs is None:
        raise KeyError(f"Could not determine CRS for {ds_path}")
    return x, y, crs


def bbox_to_window(x, y, crs, bbox):
    """Row/column slices covering a lon/lat bbox (edges densified before transforming)."""
    west, south, east, north = bbox
    tr = Transformer.from_crs("EPSG:4326", crs, always_xy=True)
    t = np.linspace(0, 1, 25)
    lon = np.concatenate([west + (east - west) * t, np.full(25, east),
                          east - (east - west) * t, np.full(25, west)])
    lat = np.concatenate([np.full(25, south), south + (north - south) * t,
                          np.full(25, north), north - (north - south) * t])
    X, Y = tr.transform(lon, lat)
    cols = np.where((x >= np.min(X)) & (x <= np.max(X)))[0]
    rows = np.where((y >= np.min(Y)) & (y <= np.max(Y)))[0]
    if cols.size == 0 or rows.size == 0:
        return None
    return slice(int(rows.min()), int(rows.max()) + 1), slice(int(cols.min()), int(cols.max()) + 1)


def estimate_window_mb(ds, rs: slice, cs: slice) -> float:
    """Uncompressed MB HDF5 must fetch: every chunk the window touches."""
    if ds.chunks:
        cr, cc = ds.chunks[-2], ds.chunks[-1]
        nr = (rs.stop - 1) // cr - rs.start // cr + 1
        nc = (cs.stop - 1) // cc - cs.start // cc + 1
        return nr * nc * cr * cc * ds.dtype.itemsize / 1e6
    return (rs.stop - rs.start) * (cs.stop - cs.start) * ds.dtype.itemsize / 1e6


def estimate_read_mb(row, var: str, bbox, frequency: str = FREQUENCY) -> float:
    """Cost of one window read, from the file's chunking alone (notebook cell 51: metadata only)."""
    rh = open_remote(row["h5_url"])
    ds_path = resolve_var(rh, var, frequency)
    x, y, crs = grid_info(rh, ds_path)
    win = bbox_to_window(x, y, crs, bbox)
    if win is None:
        raise ValueError(f"AOI does not overlap {rh.name}")
    return estimate_window_mb(rh.h5[ds_path], *win)


def read_window(rh: RemoteH5, ds_path: str, bbox, max_mb: float = MAX_READ_MB):
    """Read only the part of a 2-D dataset covering bbox. Returns (array, x, y, crs)."""
    ds = rh.h5[ds_path]
    x, y, crs = grid_info(rh, ds_path)
    win = bbox_to_window(x, y, crs, bbox)
    if win is None:
        raise ValueError(f"AOI does not overlap {rh.name} ({ds_path}).")
    rs, cs = win
    est = estimate_window_mb(ds, rs, cs)
    if est > max_mb:
        raise ReadBudgetError(
            f"Window needs ~{est:.0f} MB (uncompressed chunks) > MAX_READ_MB={max_mb}. "
            "Shrink the bbox, use frequency B, or raise MAX_READ_MB."
        )
    b0, n0 = rh.network_bytes(), rh.counter.nread
    with timer() as t:
        arr = ds[rs, cs]
    note = (f"window {arr.shape} of {ds.shape} · est {est:.1f} MB uncompressed · "
            f"h5py requested {(rh.counter.nread - n0) / 1e6:.2f} MB")
    log_op("PARTIAL" if str(rh.url).startswith("http") else "LOCAL",
           f"{rh.name}:{ds_path.split('/grids/')[-1]}", rh.network_bytes() - b0, t["seconds"], note)
    fill = ds.attrs.get("_FillValue")
    if np.iscomplexobj(arr):
        arr = arr.astype("complex64")
    elif np.issubdtype(arr.dtype, np.floating):
        arr = arr.astype("float32")
    if fill is not None and not np.iscomplexobj(arr) and np.issubdtype(arr.dtype, np.floating):
        arr = np.where(arr == np.atleast_1d(fill)[0], np.nan, arr)
    return arr, x[cs], y[rs], crs


# ---------------------------------------------------------------- common lon/lat grid
def aoi_grid(bbox, res_deg: float):
    """Transform and pixel-centre coordinates of the common AOI grid."""
    west, south, east, north = bbox
    w = max(1, int(round((east - west) / res_deg)))
    h = max(1, int(round((north - south) / res_deg)))
    lons = west + res_deg * (np.arange(w) + 0.5)
    lats = north - res_deg * (np.arange(h) + 0.5)
    return from_origin(west, north, res_deg, res_deg), lons, lats


def to_aoi_grid(arr, x, y, crs, bbox, res_deg: float = GCOV_RES_DEG, resampling: str = "average"):
    """Reproject a UTM window onto the common lon/lat AOI grid (coordinates are pixel centres)."""
    a, x, y = arr, np.asarray(x), np.asarray(y)
    if x.size > 1 and x[1] < x[0]:
        a, x = a[:, ::-1], x[::-1]
    if y.size > 1 and y[1] > y[0]:
        a, y = a[::-1, :], y[::-1]
    dx = float(np.median(np.diff(x))) if x.size > 1 else 1.0
    dy = float(abs(np.median(np.diff(y)))) if y.size > 1 else 1.0
    src_tr = from_origin(x[0] - dx / 2, y[0] + dy / 2, dx, dy)
    dst_tr, lons, lats = aoi_grid(bbox, res_deg)

    def _rp(band, how):
        out = np.full((lats.size, lons.size), np.nan, dtype="float32")
        reproject(np.ascontiguousarray(band, dtype="float32"), out, src_transform=src_tr,
                  src_crs=crs.to_wkt(), dst_transform=dst_tr, dst_crs="EPSG:4326",
                  resampling=Resampling[how], src_nodata=np.nan, dst_nodata=np.nan)
        return out

    if np.iscomplexobj(a):
        how = "bilinear" if resampling == "average" else resampling
        data = _rp(a.real, how) + 1j * _rp(a.imag, how)
    else:
        data = _rp(a, resampling)
    return xr.DataArray(data, coords={"lat": lats, "lon": lons}, dims=("lat", "lon"))


# ---------------------------------------------------------------- cached reader
def _subset_path(name: str, var: str, bbox, res_deg: float, frequency: str) -> Path:
    key = hashlib.sha1(
        f"{name}|{var}|{frequency}|{[round(b, 5) for b in bbox]}|{res_deg}".encode()
    ).hexdigest()[:10]
    safe = re.sub(r"[^A-Za-z0-9]+", "-", var).strip("-")[:40]
    (CACHE_DIR / "subsets").mkdir(parents=True, exist_ok=True)
    return CACHE_DIR / "subsets" / f"{name.replace('.h5', '')}__{safe}__f{frequency}__{key}.tif"


def _save_subset(da: xr.DataArray, path: Path, meta: dict) -> None:
    tr, _, _ = aoi_grid(meta["bbox"], meta["res_deg"])
    data = da.values
    bands = [data.real, data.imag] if np.iscomplexobj(data) else [data]
    with rasterio.open(path, "w", driver="GTiff", height=data.shape[0], width=data.shape[1],
                       count=len(bands), dtype="float32", crs="EPSG:4326", transform=tr,
                       nodata=np.nan, compress="deflate") as dst:
        for i, band in enumerate(bands, 1):
            dst.write(band.astype("float32"), i)
        dst.update_tags(**{k: str(v) for k, v in meta.items()})


def _load_subset(path: Path) -> xr.DataArray:
    with rasterio.open(path) as src:
        bands = src.read().astype("float32")
        tags = src.tags()
        tr, w, h = src.transform, src.width, src.height
    data = bands[0] + 1j * bands[1] if bands.shape[0] == 2 else bands[0]
    lons = tr.c + tr.a * (np.arange(w) + 0.5)
    lats = tr.f + tr.e * (np.arange(h) + 0.5)
    return xr.DataArray(data, coords={"lat": lats, "lon": lons}, dims=("lat", "lon"), attrs=tags)


def read_aoi(row, var: str, bbox, res_deg: float = GCOV_RES_DEG, frequency: str = FREQUENCY,
             resampling: str = "average", use_cache: bool = True,
             offline: bool = False) -> xr.DataArray:
    """One variable over the AOI on the common grid: from the cache if present, else streamed."""
    url, name = row["h5_url"], row["name"]
    date = str(pd.Timestamp(row["date"]).date())
    path = _subset_path(name, var, bbox, res_deg, frequency)
    if use_cache and path.exists():
        with timer() as t:
            da = _load_subset(path)
        log_op("LOCAL", path.name, path.stat().st_size, t["seconds"], "cached subset (no network)")
        da.attrs.update(name=name, var=var, date=date)
        return da
    if offline:
        raise FileNotFoundError(f"--offline, but no cached subset for {name} {var} ({path.name})")
    rh = open_remote(url)
    ds_path = resolve_var(rh, var, frequency)
    arr, x, y, crs = read_window(rh, ds_path, bbox)
    da = to_aoi_grid(arr, x, y, crs, bbox, res_deg, resampling)
    da.attrs.update(name=name, var=var, ds_path=ds_path, date=date, bbox=list(bbox),
                    res_deg=res_deg, frequency=frequency, crs=crs.to_string(),
                    resampling=resampling)
    _save_subset(da, path, dict(da.attrs))
    return da
