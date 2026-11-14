using UnityEngine;

namespace Nisar.Globe
{
    /// Builds the dark-style globe (surface + atmosphere) and owns its orientation.
    /// Orientation is yaw (spin around the poles) + pitch (tilt toward the viewer), so north always stays up.
    /// Children of `Spin` (labels, pins) rotate with the Earth.
    ///
    /// Map mode: EnterMap(lat, lon) morphs the sphere into a flat, zoomed-in map window centred on that point
    /// (done in the vertex shader; labels/pins follow via SurfaceLocal/SurfaceRotationLocal). ExitMap() rolls it back.
    public class GlobeView : MonoBehaviour
    {
        [Header("Shape")]
        public float radius = 0.25f;
        [Range(32, 256)] public int lonSegments = 192;
        [Range(16, 128)] public int latSegments = 96;

        [Header("Look")]
        [Tooltip("Defaults to Resources/globe_dark (made by pipeline/make_globe_texture.py).")]
        public Texture2D surfaceTexture;
        public Color rimColor = new Color(0.45f, 0.7f, 1f);
        [Range(0f, 3f)] public float rimStrength = 1.1f;
        public Color atmosphereColor = new Color(0.35f, 0.6f, 1f);
        [Range(1.01f, 1.2f)] public float atmosphereScale = 1.06f;
        [Range(0f, 2f)] public float atmosphereIntensity = 0.9f;
        public Vector3 lightDirection = new Vector3(-0.5f, 0.6f, -0.6f);

        [Header("View")]
        public float startLat = 22f;
        public float startLon = 28f;
        public float idleSpinDegPerSec = 2f;
        public float idleDelay = 8f;
        public float focusSpeed = 4f;
        public float maxPitch = 80f;
        public Vector2 zoomRange = new Vector2(0.5f, 2.5f);
        public bool faceViewerOnStart = true;

        [Header("Map mode (click a point to flatten)")]
        [Tooltip("Size of the flat map window in metres (before globe zoom).")]
        public Vector2 mapSize = new Vector2(0.8f, 0.52f);
        public float mapCornerRadius = 0.03f;
        [Tooltip("How far the map zooms in after flattening (1 = same scale as the globe).")]
        public float mapStartZoom = 4f;
        public Vector2 mapZoomRange = new Vector2(1.5f, 12f);
        [Tooltip("Highest map zoom (story areas such as a 25 km lagoon need a few hundred times).")]
        public float mapMaxZoom = 800f;
        public float flattenDuration = 1.1f;
        [Tooltip("How much farther from you (metres) the flat map sits than the globe.")]
        public float mapPushBack = 0.5f;
        public Color mapFrameColor = new Color(0.45f, 0.7f, 1f, 1f);

        public Transform Spin { get; private set; }
        public float Zoom { get; private set; } = 1f;
        /// Pauses the idle spin (e.g. while a site is selected).
        public bool HoldIdle { get; set; }
        public Vector3 Center => transform.position;
        public float WorldRadius => radius * transform.lossyScale.x;

        /// 0 = globe, 1 = flat map (eased).
        public float Flatten { get; private set; }
        public bool IsMap => flattenTarget > 0.5f;
        public bool MapReady => IsMap && Flatten >= 0.999f;
        public bool Morphing => Flatten > 0f && Flatten < 0.999f;
        public float MapZoom => mapZoom;
        /// Zoom shown to the user: map zoom in map mode, globe scale otherwise.
        public float DisplayZoom => IsMap ? mapZoom : Zoom;

        float yaw, pitch, idleTimer;
        bool focusing;
        float focusYaw, focusPitch;
        Vector3 baseScale;

        float flattenT, flattenTarget;
        float mapZoom = 4f, mapZoomTarget = 4f, mapLat, mapLon, mapTargetLat, mapTargetLon, meshCenterLon;
        bool mapPanning, exitPending, hasRest;
        Vector3 restPos;
        Material globeMat, atmoMat;
        MeshFilter surfaceFilter;

        static readonly int FlattenId = Shader.PropertyToID("_Flatten");
        static readonly int MapCenterId = Shader.PropertyToID("_MapCenter");
        static readonly int MapWindowId = Shader.PropertyToID("_MapWindow");
        static readonly int SpinInvId = Shader.PropertyToID("_SpinInv");
        static readonly int IntensityId = Shader.PropertyToID("_Intensity");

        void Awake()
        {
            baseScale = transform.localScale;
            Build();
        }

        void Start()
        {
            if (faceViewerOnStart) FaceViewer();
            SetView(startLat, startLon);
        }

        void Build()
        {
            Spin = new GameObject("Spin").transform;
            Spin.SetParent(transform, false);

            var tex = surfaceTexture != null ? surfaceTexture : Resources.Load<Texture2D>("globe_dark");
            globeMat = CreateMaterial("Nisar/Globe");
            if (globeMat != null)
            {
                globeMat.SetTexture("_MainTex", tex);
                globeMat.SetColor("_RimColor", rimColor);
                globeMat.SetFloat("_RimStrength", rimStrength);
                globeMat.SetVector("_LightDir", lightDirection.normalized);
                globeMat.SetColor("_FrameColor", mapFrameColor);
            }
            var surface = CreateMeshObject("Surface", Spin, BuildSurfaceMesh(0f), globeMat);
            surfaceFilter = surface.GetComponent<MeshFilter>();

            atmoMat = CreateMaterial("Nisar/Atmosphere");
            if (atmoMat != null)
            {
                atmoMat.SetColor("_Color", atmosphereColor);
                atmoMat.SetFloat("_Intensity", atmosphereIntensity);
                atmoMat.SetFloat("_Edge", Mathf.Sqrt(1f - 1f / (atmosphereScale * atmosphereScale)));
                atmoMat.SetVector("_LightDir", lightDirection.normalized);
            }
            CreateMeshObject("Atmosphere", transform, GeoMath.BuildSphere(64, 32, radius * atmosphereScale), atmoMat);
        }

        Mesh BuildSurfaceMesh(float centerLon)
        {
            meshCenterLon = centerLon;
            var mesh = GeoMath.BuildSphere(lonSegments, latSegments, radius, centerLon);
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * radius * 60f); // flattened vertices spread far
            return mesh;
        }

        public static Material CreateMaterial(string shaderName)
        {
            var shader = Shader.Find(shaderName);
            if (shader == null)
            {
                Debug.LogError($"[Globe] Shader '{shaderName}' not found (expected in Assets/Globe/Resources/Shaders).");
                return null;
            }
            return new Material(shader);
        }

        public static GameObject CreateMeshObject(string name, Transform parent, Mesh mesh, Material mat)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var mr = go.AddComponent<MeshRenderer>();
            mr.sharedMaterial = mat;
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            return go;
        }

        void Update()
        {
            float dt = Time.deltaTime;
            if (focusing)
            {
                float k = 1f - Mathf.Exp(-focusSpeed * dt);
                yaw = Mathf.LerpAngle(yaw, focusYaw, k);
                pitch = Mathf.Lerp(pitch, focusPitch, k);
                if (Mathf.Abs(Mathf.DeltaAngle(yaw, focusYaw)) < 0.05f && Mathf.Abs(pitch - focusPitch) < 0.05f)
                    focusing = false;
            }
            else
            {
                idleTimer += dt;
                if (!HoldIdle && !IsMap && Flatten <= 0f && idleTimer > idleDelay)
                    yaw -= idleSpinDegPerSec * dt;
            }
            Apply();
            UpdateMap(dt);
        }

        void Apply()
        {
            yaw = Mathf.Repeat(yaw + 180f, 360f) - 180f;
            pitch = Mathf.Clamp(pitch, -maxPitch, maxPitch);
            Spin.localRotation = Quaternion.AngleAxis(pitch, Vector3.right) * Quaternion.AngleAxis(yaw, Vector3.up);
        }

        void UpdateMap(float dt)
        {
            // Leaving the map: zoom back out first, then roll the map up.
            if (exitPending)
            {
                mapZoomTarget = mapStartZoom;
                if (mapZoom <= mapStartZoom * 1.15f)
                {
                    exitPending = false;
                    flattenTarget = 0f;
                }
            }
            flattenT = Mathf.MoveTowards(flattenT, flattenTarget, dt / Mathf.Max(0.05f, flattenDuration));
            Flatten = flattenT * flattenT * (3f - 2f * flattenT);

            // The flat map sits a bit farther away than the globe.
            if (Flatten > 0f || hasRest)
            {
                if (!hasRest) { restPos = transform.position; hasRest = true; }
                transform.position = restPos + transform.forward * mapPushBack * Flatten;
                if (Flatten <= 0f) hasRest = false;
            }

            if (!mapPanning)
            {
                float k = 1f - Mathf.Exp(-focusSpeed * dt);
                mapLat = Mathf.Lerp(mapLat, mapTargetLat, k);
                mapLon = Mathf.LerpAngle(mapLon, mapTargetLon, k);
            }
            // Zoom only once the map is flat (zooming mid-morph makes the half-unrolled surface huge
            // and it covers the sky). It eases in log space so big jumps (4x -> 300x) feel even.
            if (Flatten >= 0.999f)
                mapZoom = Mathf.Exp(Mathf.Lerp(Mathf.Log(mapZoom), Mathf.Log(mapZoomTarget), 1f - Mathf.Exp(-3f * dt)));
            mapPanning = false;
            mapLon = Mathf.Repeat(mapLon + 180f, 360f) - 180f;

            // Keep the mesh seam far from the map centre while panning.
            if (Flatten > 0f && Mathf.Abs(Mathf.DeltaAngle(meshCenterLon, mapLon)) > 90f)
                surfaceFilter.sharedMesh = BuildSurfaceMesh(mapLon);

            if (globeMat != null)
            {
                globeMat.SetFloat(FlattenId, Flatten);
                globeMat.SetVector(MapCenterId, new Vector4(mapLat, Mathf.DeltaAngle(meshCenterLon, mapLon), EffectiveMapZoom, radius));
                globeMat.SetVector(MapWindowId, new Vector4(mapSize.x * 0.5f, mapSize.y * 0.5f, mapCornerRadius, 0f));
                globeMat.SetMatrix(SpinInvId, Matrix4x4.Rotate(Quaternion.Inverse(Spin.localRotation)));
            }
            if (atmoMat != null) atmoMat.SetFloat(IntensityId, atmosphereIntensity * (1f - Flatten));
        }

        float EffectiveMapZoom => Mathf.Lerp(1f, mapZoom, Flatten);

        // ---------- view control ----------

        /// Turns the globe root so its -Z (lon 0 / lat 0 at rest) faces the main camera.
        public void FaceViewer()
        {
            var cam = Camera.main;
            if (cam == null) return;
            Vector3 to = transform.position - cam.transform.position;
            to.y = 0f;
            if (to.sqrMagnitude > 1e-4f) transform.rotation = Quaternion.LookRotation(to.normalized, Vector3.up);
        }

        /// Moves the globe in front of the main camera and faces it.
        public void Recenter(float distance = 0.7f)
        {
            var cam = Camera.main;
            if (cam == null) return;
            Vector3 fwd = cam.transform.forward;
            fwd.y = 0f;
            if (fwd.sqrMagnitude < 1e-4f) fwd = Vector3.forward;
            transform.position = cam.transform.position + fwd.normalized * distance - Vector3.up * 0.1f;
            FaceViewer();
            if (hasRest)
            {
                restPos = transform.position;
                transform.position = restPos + transform.forward * mapPushBack * Flatten;
            }
            NotifyInteraction();
        }

        public void SetView(float lat, float lon)
        {
            yaw = lon;
            pitch = -lat;
            focusing = false;
            Apply();
        }

        /// Smoothly turns the globe (or pans the map) so (lat, lon) faces the viewer.
        public void FocusOn(float lat, float lon)
        {
            focusYaw = lon;
            focusPitch = Mathf.Clamp(-lat, -maxPitch, maxPitch);
            focusing = true;
            idleTimer = 0f;
            if (IsMap)
            {
                mapTargetLat = Mathf.Clamp(lat, -80f, 80f);
                mapTargetLon = lon;
            }
        }

        /// Flattens the globe into a zoomed-in map centred on (lat, lon).
        public void EnterMap(float lat, float lon)
        {
            exitPending = false;
            if (!IsMap)
            {
                surfaceFilter.sharedMesh = BuildSurfaceMesh(lon);
                mapZoom = mapZoomTarget = mapStartZoom;
            }
            mapLat = mapTargetLat = Mathf.Clamp(lat, -80f, 80f);
            mapLon = mapTargetLon = lon;
            flattenTarget = 1f;
            FocusOn(lat, lon);
        }

        /// Pans and zooms the map (smoothly) so the box fills about `fill` of the map window.
        public void FitMapTo(float minLat, float minLon, float maxLat, float maxLon, float fill = 0.7f)
        {
            float cLat = (minLat + maxLat) * 0.5f;
            float spanLon = Mathf.Abs(Mathf.DeltaAngle(minLon, maxLon));
            float dLon = Mathf.Max(spanLon * Mathf.Deg2Rad * Mathf.Cos(cLat * Mathf.Deg2Rad), 1e-5f);
            float dLat = Mathf.Max((maxLat - minLat) * Mathf.Deg2Rad, 1e-5f);
            float z = Mathf.Min(mapSize.x * fill / (dLon * radius), mapSize.y * fill / (dLat * radius));
            mapZoomTarget = Mathf.Clamp(z, mapZoomRange.x, mapMaxZoom);
            mapTargetLat = Mathf.Clamp(cLat, -80f, 80f);
            mapTargetLon = minLon + Mathf.DeltaAngle(minLon, maxLon) * 0.5f;
            idleTimer = 0f;
        }

        /// Where a side panel `width` metres wide should float: just right of the globe or the map window.
        public Vector3 PanelAnchor(float width, float gap = 0.05f)
        {
            Vector3 right = transform.right;
            Vector3 globeEdge = Center + right * WorldRadius * 1.1f;
            Vector3 mapEdge = transform.TransformPoint(new Vector3(mapSize.x * 0.5f, 0f, -radius));
            return Vector3.Lerp(globeEdge, mapEdge, Flatten) + right * (gap + width * 0.5f);
        }

        /// Rolls the map back up into the globe.
        public void ExitMap()
        {
            if (Flatten >= 0.999f && mapZoom > mapStartZoom * 1.15f) exitPending = true; // zoom out first
            else flattenTarget = 0f;
            idleTimer = 0f;
        }

        public void RotateBy(float dYaw, float dPitch)
        {
            if (IsMap)
            {
                mapTargetLon = mapLon = mapLon + dYaw / mapZoom;
                mapTargetLat = mapLat = Mathf.Clamp(mapLat + dPitch / mapZoom, -80f, 80f);
                idleTimer = 0f;
                return;
            }
            yaw += dYaw;
            pitch += dPitch;
            focusing = false;
            idleTimer = 0f;
            Apply();
        }

        /// Rotates (globe) or pans (map) so the point grabbed at (grabLat, grabLon) follows `worldPoint`.
        public void DragTo(float grabLat, float grabLon, Vector3 worldPoint)
        {
            if (MapReady)
            {
                Vector3 l = transform.InverseTransformPoint(worldPoint);
                float scale = radius * mapZoom;
                mapLat = Mathf.Clamp(grabLat - l.y / scale * Mathf.Rad2Deg, -80f, 80f);
                mapLon = grabLon - l.x / (scale * Mathf.Cos(mapLat * Mathf.Deg2Rad)) * Mathf.Rad2Deg;
                mapTargetLat = mapLat;
                mapTargetLon = mapLon;
                mapPanning = true;
                idleTimer = 0f;
                return;
            }

            Vector3 v = transform.InverseTransformDirection(worldPoint - Center).normalized;
            Vector3 cur = Spin.localRotation * GeoMath.LatLonToDir(grabLat, grabLon);
            pitch += (Mathf.Asin(Mathf.Clamp(v.y, -1f, 1f)) - Mathf.Asin(Mathf.Clamp(cur.y, -1f, 1f))) * Mathf.Rad2Deg;
            pitch = Mathf.Clamp(pitch, -maxPitch, maxPitch);
            Vector3 u = Quaternion.AngleAxis(-pitch, Vector3.right) * v;
            yaw = grabLon - Mathf.Atan2(u.x, -u.z) * Mathf.Rad2Deg;
            focusing = false;
            idleTimer = 0f;
            Apply();
        }

        public void ZoomBy(float factor) => SetDisplayZoom(DisplayZoom * factor);

        /// Sets the map zoom in map mode, the globe size otherwise.
        public void SetDisplayZoom(float zoom)
        {
            if (IsMap) mapZoom = mapZoomTarget = Mathf.Clamp(zoom, mapZoomRange.x, mapMaxZoom);
            else SetZoom(zoom);
            idleTimer = 0f;
        }

        public void SetZoom(float zoom)
        {
            Zoom = Mathf.Clamp(zoom, zoomRange.x, zoomRange.y);
            transform.localScale = baseScale * Zoom;
            idleTimer = 0f;
        }

        public void NotifyInteraction() => idleTimer = 0f;

        // ---------- geometry queries ----------

        public bool Raycast(Ray ray, out Vector3 hit)
        {
            hit = default;
            if (Morphing || (IsMap && !MapReady)) return false;
            if (MapReady) return RaycastMap(ray, out hit, true);

            Vector3 oc = ray.origin - Center;
            float r = WorldRadius;
            float b = Vector3.Dot(oc, ray.direction);
            float disc = b * b - (oc.sqrMagnitude - r * r);
            if (disc < 0f) return false;
            float s = Mathf.Sqrt(disc);
            float t = -b - s;
            if (t < 0f) t = -b + s;
            if (t < 0f) return false;
            hit = ray.origin + ray.direction * t;
            return true;
        }

        bool RaycastMap(Ray ray, out Vector3 hit, bool requireInside)
        {
            hit = default;
            Vector3 o = transform.InverseTransformPoint(ray.origin);
            Vector3 d = transform.InverseTransformVector(ray.direction);
            if (Mathf.Abs(d.z) < 1e-6f) return false;
            float t = (-radius - o.z) / d.z;
            if (t < 0f) return false;
            Vector3 p = o + d * t;
            if (requireInside && (Mathf.Abs(p.x) > mapSize.x * 0.5f || Mathf.Abs(p.y) > mapSize.y * 0.5f)) return false;
            hit = transform.TransformPoint(p);
            return true;
        }

        /// Point on the surface nearest to the ray (used when the pointer slides off the edge mid-drag).
        public Vector3 ClosestSurfacePoint(Ray ray)
        {
            if (MapReady && RaycastMap(ray, out Vector3 h, false)) return h;
            float t = Mathf.Max(0f, Vector3.Dot(Center - ray.origin, ray.direction));
            Vector3 p = ray.origin + ray.direction * t;
            return Center + (p - Center).normalized * WorldRadius;
        }

        /// World-space normal of the surface at `worldPoint` (the map faces the viewer).
        public Vector3 SurfaceNormal(Vector3 worldPoint) =>
            MapReady ? -transform.forward : (worldPoint - Center).normalized;

        /// Point just above the globe or the map window, for floating labels.
        public Vector3 ContentTop
        {
            get
            {
                Vector3 globeTop = Center + Vector3.up * WorldRadius * 1.15f;
                Vector3 mapTop = transform.TransformPoint(new Vector3(0f, mapSize.y * 0.5f + 0.03f, -radius));
                return Vector3.Lerp(globeTop, mapTop, Flatten);
            }
        }

        /// (x = lat, y = lon) of a world-space point on/near the globe or map.
        public Vector2 WorldToLatLon(Vector3 worldPoint)
        {
            if (MapReady)
            {
                Vector3 l = transform.InverseTransformPoint(worldPoint);
                float scale = radius * mapZoom;
                float lat = Mathf.Clamp(mapLat + l.y / scale * Mathf.Rad2Deg, -90f, 90f);
                float lon = mapLon + l.x / (scale * Mathf.Cos(mapLat * Mathf.Deg2Rad)) * Mathf.Rad2Deg;
                return new Vector2(lat, Mathf.Repeat(lon + 180f, 360f) - 180f);
            }
            return GeoMath.DirToLatLon(Spin.InverseTransformDirection(worldPoint - Center));
        }

        public Vector3 LatLonToWorld(float lat, float lon, float lift = 0f) =>
            Spin.TransformPoint(SurfaceLocal(lat, lon, lift));

        /// Position on the sphere in Spin space.
        public Vector3 LatLonToLocal(float lat, float lon, float lift = 0f) =>
            GeoMath.LatLonToDir(lat, lon) * radius * (1f + lift);

        /// Position on the (possibly flattened) surface in Spin space. Mirrors the globe shader.
        public Vector3 SurfaceLocal(float lat, float lon, float lift = 0f)
        {
            Vector3 sphere = LatLonToLocal(lat, lon, lift);
            if (Flatten <= 0f) return sphere;
            Vector3 flat = Quaternion.Inverse(Spin.localRotation) * MapRootPoint(lat, lon, lift);
            return Vector3.Lerp(sphere, flat, Flatten);
        }

        /// Blends a sphere-surface rotation (Spin space) with a flat-map rotation given in root space.
        public Quaternion SurfaceRotationLocal(Quaternion sphereLocal, Quaternion flatRoot)
        {
            if (Flatten <= 0f) return sphereLocal;
            return Quaternion.Slerp(sphereLocal, Quaternion.Inverse(Spin.localRotation) * flatRoot, Flatten);
        }

        /// True if (lat, lon) is inside the flat map window (with an optional inner margin in metres).
        public bool InMapWindow(float lat, float lon, float margin = 0f)
        {
            Vector3 p = MapRootPoint(lat, lon, 0f);
            return Mathf.Abs(p.x) <= mapSize.x * 0.5f - margin && Mathf.Abs(p.y) <= mapSize.y * 0.5f - margin;
        }

        Vector3 MapRootPoint(float lat, float lon, float lift)
        {
            float scale = radius * EffectiveMapZoom;
            float dLon = Mathf.DeltaAngle(mapLon, lon) * Mathf.Deg2Rad;
            float dLat = (lat - mapLat) * Mathf.Deg2Rad;
            return new Vector3(dLon * Mathf.Cos(mapLat * Mathf.Deg2Rad) * scale, dLat * scale, -radius * (1f + lift));
        }
    }
}
