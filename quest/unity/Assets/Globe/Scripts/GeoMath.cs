using UnityEngine;

namespace Nisar.Globe
{
    /// Lat/lon <-> direction conversions and procedural meshes.
    /// Convention (globe-local space): lat 0 / lon 0 faces -Z, +Y is the north pole, east is +X.
    /// The sphere mesh UVs match the equirectangular texture (u = lon, v = lat), so no calibration is needed.
    public static class GeoMath
    {
        const float EarthRadiusKm = 6371f;

        public static Vector3 LatLonToDir(float latDeg, float lonDeg)
        {
            float la = latDeg * Mathf.Deg2Rad, lo = lonDeg * Mathf.Deg2Rad;
            return new Vector3(Mathf.Cos(la) * Mathf.Sin(lo), Mathf.Sin(la), -Mathf.Cos(la) * Mathf.Cos(lo));
        }

        /// Returns (x = lat, y = lon) in degrees.
        public static Vector2 DirToLatLon(Vector3 dir)
        {
            dir.Normalize();
            float lat = Mathf.Asin(Mathf.Clamp(dir.y, -1f, 1f)) * Mathf.Rad2Deg;
            float lon = Mathf.Atan2(dir.x, -dir.z) * Mathf.Rad2Deg;
            return new Vector2(lat, lon);
        }

        /// Unit vector pointing north along the surface at `dir`.
        public static Vector3 North(Vector3 dir)
        {
            Vector3 n = Vector3.up - dir * dir.y;
            return n.sqrMagnitude < 1e-6f ? Vector3.forward : n.normalized;
        }

        public static float DistanceKm(float lat1, float lon1, float lat2, float lon2)
        {
            float p1 = lat1 * Mathf.Deg2Rad, p2 = lat2 * Mathf.Deg2Rad;
            float dp = p2 - p1, dl = (lon2 - lon1) * Mathf.Deg2Rad;
            float a = Mathf.Sin(dp / 2) * Mathf.Sin(dp / 2) + Mathf.Cos(p1) * Mathf.Cos(p2) * Mathf.Sin(dl / 2) * Mathf.Sin(dl / 2);
            return 2f * EarthRadiusKm * Mathf.Asin(Mathf.Min(1f, Mathf.Sqrt(a)));
        }

        public static string Format(float lat, float lon) =>
            $"{Mathf.Abs(lat):0.00}°{(lat >= 0 ? "N" : "S")}   {Mathf.Abs(lon):0.00}°{(lon >= 0 ? "E" : "W")}";

        /// `centerLon` puts the mesh seam on the far side of that longitude (used by the flat-map morph).
        /// uv2 = (lat, lon - centerLon) in degrees.
        public static Mesh BuildSphere(int lonSegments, int latSegments, float radius, float centerLon = 0f)
        {
            int cols = lonSegments + 1, rows = latSegments + 1;
            var verts = new Vector3[cols * rows];
            var normals = new Vector3[verts.Length];
            var uvs = new Vector2[verts.Length];
            var geo = new Vector2[verts.Length];
            for (int i = 0; i < rows; i++)
            {
                float v = (float)i / latSegments;
                float lat = -90f + 180f * v;
                for (int j = 0; j < cols; j++)
                {
                    float rel = -180f + 360f * j / lonSegments;
                    float lon = centerLon + rel;
                    Vector3 d = LatLonToDir(lat, lon);
                    int k = i * cols + j;
                    verts[k] = d * radius;
                    normals[k] = d;
                    uvs[k] = new Vector2((lon + 180f) / 360f, v); // may leave 0..1; the texture repeats in U
                    geo[k] = new Vector2(lat, rel);
                }
            }

            var tris = new int[lonSegments * latSegments * 6];
            int t = 0;
            for (int i = 0; i < latSegments; i++)
            {
                for (int j = 0; j < lonSegments; j++)
                {
                    int a = i * cols + j, b = a + 1, c = a + cols, d = c + 1;
                    tris[t++] = a; tris[t++] = c; tris[t++] = d;
                    tris[t++] = a; tris[t++] = d; tris[t++] = b;
                }
            }

            var mesh = new Mesh { name = "GlobeSphere" };
            if (verts.Length > 65535) mesh.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
            mesh.vertices = verts;
            mesh.normals = normals;
            mesh.uv = uvs;
            mesh.uv2 = geo;
            mesh.triangles = tris;
            mesh.RecalculateBounds();
            return mesh;
        }

        /// Unit quad in the XY plane centred on the origin, readable from -Z (UV 0..1).
        public static Mesh BuildQuad()
        {
            var mesh = new Mesh
            {
                name = "Quad",
                vertices = new[] { new Vector3(-0.5f, -0.5f), new Vector3(0.5f, -0.5f), new Vector3(-0.5f, 0.5f), new Vector3(0.5f, 0.5f) },
                uv = new[] { new Vector2(0, 0), new Vector2(1, 0), new Vector2(0, 1), new Vector2(1, 1) },
                triangles = new[] { 0, 2, 1, 2, 3, 1 },
            };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }

        /// Thin ring in the XY plane (radius 1, given thickness), readable from -Z.
        public static Mesh BuildRing(float thickness, int segments = 128)
        {
            var verts = new Vector3[(segments + 1) * 2];
            var tris = new int[segments * 6];
            float r0 = 1f - thickness * 0.5f, r1 = 1f + thickness * 0.5f;
            for (int i = 0; i <= segments; i++)
            {
                float a = i * Mathf.PI * 2f / segments;
                var d = new Vector3(Mathf.Cos(a), Mathf.Sin(a), 0f);
                verts[i * 2] = d * r0;
                verts[i * 2 + 1] = d * r1;
            }
            for (int i = 0; i < segments; i++)
            {
                int a = i * 2, t = i * 6;
                tris[t] = a; tris[t + 1] = a + 1; tris[t + 2] = a + 2;
                tris[t + 3] = a + 1; tris[t + 4] = a + 3; tris[t + 5] = a + 2;
            }
            var mesh = new Mesh { name = "Ring", vertices = verts, triangles = tris };
            mesh.RecalculateBounds();
            return mesh;
        }

        /// Flat unit disc in the XZ plane, facing +Y.
        public static Mesh BuildDisc(int segments = 32)
        {
            var verts = new Vector3[segments + 1];
            var tris = new int[segments * 3];
            verts[0] = Vector3.zero;
            for (int i = 0; i < segments; i++)
            {
                float a = i * Mathf.PI * 2f / segments;
                verts[i + 1] = new Vector3(Mathf.Cos(a), 0f, Mathf.Sin(a));
                tris[i * 3] = 0;
                tris[i * 3 + 1] = (i + 1) % segments + 1;
                tris[i * 3 + 2] = i + 1;
            }
            var mesh = new Mesh { name = "Disc", vertices = verts, triangles = tris };
            mesh.RecalculateNormals();
            mesh.RecalculateBounds();
            return mesh;
        }
    }
}
