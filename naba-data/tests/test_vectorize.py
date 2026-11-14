"""Rasters to polygons: areas must come out right and speckle must not survive."""
import numpy as np
import pytest

from naba_data.vectorize import (geodesic_area_km2, geometry_mapping, mask_to_multipolygon,
                                 round_coords, union_all, vertex_count)

# 100 x 100 cells of 0.001 deg over a small AOI: roughly 111 m cells near the equator-ish latitude.
BBOX = (31.95, 31.15, 32.05, 31.25)
RES = 0.001


def _blank():
    return np.zeros((100, 100), dtype=bool)


def test_square_mask_area_is_close_to_the_geodesic_truth():
    mask = _blank()
    mask[20:40, 30:50] = True                 # 20 x 20 cells = 0.02 x 0.02 degrees
    geom = mask_to_multipolygon(mask, BBOX, RES, min_area_km2=0.0, simplify_m=0, majority=0)
    # at about 31.2 N, 0.02 deg of longitude is ~1.90 km and 0.02 deg of latitude ~2.22 km
    expected_km2 = (0.02 * 111.32 * 0.8555) * (0.02 * 110.57)
    assert geom.geom_type == "MultiPolygon"
    assert geodesic_area_km2(geom) == pytest.approx(expected_km2, rel=0.02)


def test_empty_mask_gives_empty_geometry_and_no_feature():
    geom = mask_to_multipolygon(_blank(), BBOX, RES)
    assert geom.is_empty
    assert geometry_mapping(geom) is None
    assert geodesic_area_km2(geom) == 0.0
    assert vertex_count(geom) == 0


def test_single_pixel_speckle_is_removed_by_the_majority_filter():
    mask = _blank()
    mask[50, 50] = True
    assert mask_to_multipolygon(mask, BBOX, RES, min_area_km2=0.0, majority=3).is_empty


def test_min_area_drops_small_parts_but_keeps_big_ones():
    mask = _blank()
    mask[10:40, 10:40] = True                 # big: ~9.5 km2
    mask[80:83, 80:83] = True                 # small: ~0.1 km2
    kept = mask_to_multipolygon(mask, BBOX, RES, min_area_km2=1.0, simplify_m=0, majority=0)
    assert len(kept.geoms) == 1


def test_union_dissolves_monthly_extents_into_one_envelope():
    a = _blank()
    a[10:30, 10:30] = True
    b = _blank()
    b[20:40, 20:40] = True                    # overlaps a
    geoms = [mask_to_multipolygon(m, BBOX, RES, min_area_km2=0.0, simplify_m=0, majority=0)
             for m in (a, b)]
    envelope = union_all(geoms)
    assert envelope.geom_type == "MultiPolygon"
    assert len(envelope.geoms) == 1           # the two months merge into one shape
    assert geodesic_area_km2(envelope) > geodesic_area_km2(geoms[0])


def test_round_coords_trims_precision_in_place_of_the_whole_mapping():
    m = {"type": "Polygon", "coordinates": [[[31.123456789, 31.987654321]]], "keep": "me"}
    out = round_coords(m, 5)
    assert out["coordinates"] == [[[31.12346, 31.98765]]]
    assert out["keep"] == "me"


def test_closed_outline_bridges_narrow_gaps_but_keeps_far_patches_apart():
    from naba_data.vectorize import closed_outline, polygonal_parts

    mask = _blank()
    mask[20:40, 10:30] = True
    mask[20:40, 32:52] = True                 # 2 cells (~190 m) to the right: bridged
    mask[70:90, 70:90] = True                 # far away: stays its own part
    patches = mask_to_multipolygon(mask, BBOX, RES, min_area_km2=0.0, simplify_m=0, majority=0)
    assert len(patches.geoms) == 3
    env = closed_outline(patches, close_m=150.0, simplify_m=0)
    assert len(env.geoms) == 2
    assert geodesic_area_km2(env) >= geodesic_area_km2(patches)
    assert env.covers(patches.buffer(-1e-9))
    assert polygonal_parts(None).is_empty
