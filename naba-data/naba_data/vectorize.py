"""Classified rasters to vector extents.

The notebook stops at rasters (it draws them with matplotlib and plotly). The app puts the data on
a globe, so each monthly class mask becomes real geometry: a MultiPolygon per class per month that
MapLibre can fill, outline, hover and measure.

Pipeline per mask: majority filter (speckle) -> rasterio.features.shapes -> repair -> drop parts
below `min_area_km2` -> simplify -> union. Areas come from `pyproj.Geod`, i.e. geodesic on the
WGS84 ellipsoid, so no projection has to be guessed.
"""
from __future__ import annotations

import logging

import numpy as np
from pyproj import Geod
from rasterio.features import shapes as raster_shapes
from rasterio.transform import from_origin
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.ops import unary_union

from .config import COORD_PRECISION, MAJORITY_FILTER, MIN_AREA_KM2, SIMPLIFY_M

log = logging.getLogger("naba_data")
GEOD = Geod(ellps="WGS84")
M_PER_DEG = 111_320.0      # metres per degree of latitude; used to convert the simplify tolerance


def geodesic_area_km2(geom) -> float:
    """Area on the WGS84 ellipsoid, in km**2."""
    if geom.is_empty:
        return 0.0
    area, _ = GEOD.geometry_area_perimeter(geom)
    return abs(area) / 1e6


def majority_filter(mask: np.ndarray, size: int = MAJORITY_FILTER) -> np.ndarray:
    """Remove isolated speckle pixels: a pixel keeps the majority value of its neighbourhood."""
    if not size or size < 3:
        return mask
    from scipy.ndimage import median_filter

    return median_filter(mask.astype("uint8"), size=size).astype(bool)


def mask_to_multipolygon(mask: np.ndarray, bbox, res_deg: float,
                         min_area_km2: float = MIN_AREA_KM2,
                         simplify_m: float = SIMPLIFY_M,
                         majority: int = MAJORITY_FILTER):
    """One boolean raster mask to a cleaned MultiPolygon in EPSG:4326."""
    if not mask.any():
        return MultiPolygon()
    mask = majority_filter(mask, majority)
    west, north = bbox[0], bbox[3]        # the AOI grid starts at its north-west corner
    transform = from_origin(west, north, res_deg, res_deg)
    parts: list[Polygon] = []
    for geom, _value in raster_shapes(mask.astype("uint8"), mask=mask, transform=transform,
                                      connectivity=4):
        poly = shape(geom)
        if not poly.is_valid:
            poly = poly.buffer(0)
        if poly.is_empty:
            continue
        if geodesic_area_km2(poly) < min_area_km2:
            continue
        parts.append(poly)
    if not parts:
        return MultiPolygon()
    merged = unary_union(parts)
    if simplify_m:
        merged = merged.simplify(simplify_m / M_PER_DEG, preserve_topology=True)
        if not merged.is_valid:
            merged = merged.buffer(0)
    if merged.geom_type == "Polygon":
        merged = MultiPolygon([merged])
    return merged


def union_all(geoms) -> MultiPolygon:
    """Dissolve several monthly extents into one 'ever this class' envelope."""
    geoms = [g for g in geoms if g is not None and not g.is_empty]
    if not geoms:
        return MultiPolygon()
    merged = unary_union(geoms)
    if not merged.is_valid:
        merged = merged.buffer(0)
    if merged.geom_type == "Polygon":
        merged = MultiPolygon([merged])
    return merged


def round_coords(obj, precision: int = COORD_PRECISION):
    """Round every coordinate in a GeoJSON geometry mapping (keeps the export small and stable)."""
    if isinstance(obj, (list, tuple)):
        if obj and isinstance(obj[0], (int, float)):
            return [round(float(v), precision) for v in obj]
        return [round_coords(o, precision) for o in obj]
    if isinstance(obj, dict):
        return {k: (round_coords(v, precision) if k == "coordinates" else v)
                for k, v in obj.items()}
    return obj


def geometry_mapping(geom, precision: int = COORD_PRECISION) -> dict | None:
    """GeoJSON geometry with rounded coordinates, or None for an empty geometry."""
    if geom is None or geom.is_empty:
        return None
    return round_coords(mapping(geom), precision)


def vertex_count(geom) -> int:
    if geom is None or geom.is_empty:
        return 0
    polys = geom.geoms if geom.geom_type == "MultiPolygon" else [geom]
    return sum(len(p.exterior.coords) + sum(len(r.coords) for r in p.interiors) for p in polys)


def monthly_extents(months: dict, class_value: int, bbox, res_deg: float, **kw) -> dict:
    """{month: {geometry, area_km2, dates}} for one class, plus the across-months envelope.

    `months` is the output of `wetlands.monthly_composites`.
    """
    out = {}
    for month, comp in months.items():
        mask = comp["classes"] == class_value
        geom = mask_to_multipolygon(mask, bbox, res_deg, **kw)
        out[month] = dict(geometry=geom, area_km2=round(geodesic_area_km2(geom), 2),
                          dates=comp["dates"])
        log.info("  %s class %d: %.2f km2, %d vertices", month, class_value,
                 out[month]["area_km2"], vertex_count(geom))
    return out
