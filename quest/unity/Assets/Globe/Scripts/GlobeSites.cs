using System;
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Events;

namespace Nisar.Globe
{
    public enum ChangeType { Agriculture, Water, Fire, Deformation, Ice }

    [Serializable]
    public class SiteInfo
    {
        public string id;
        public string name;
        public float lat;
        public float lon;
        public ChangeType type;
        [TextArea] public string story;

        /// Set when the site comes from the NABA story data (Resources/Stories/stories.json).
        [NonSerialized] public StoryData data;
        [NonSerialized] public Color color;
        [NonSerialized] public string label;

        public Color Color => data != null ? color : GlobeSites.ColorOf(type);
        public string Label => data != null ? label : GlobeSites.LabelOf(type);
    }

    [Serializable] public class SiteEvent : UnityEvent<SiteInfo> { }
    [Serializable] public class LocationEvent : UnityEvent<float, float> { }

    /// Story pins on the globe, hover/selection highlighting and picking.
    /// Pins come only from the NABA stories (Resources/Stories/stories.json), each at the story's exact lat/lon
    /// (the same point the web map uses); there are no placeholder sites.
    [RequireComponent(typeof(GlobeView))]
    public class GlobeSites : MonoBehaviour
    {
        [Tooltip("A tap within this distance of a site selects it (on the flat map: within ~5 cm of the pin).")]
        public float selectRadiusKm = 400f;
        [Tooltip("Pin radius as a fraction of the globe radius.")]
        public float pinSize = 0.035f;

        public SiteEvent onSiteSelected = new SiteEvent();
        public LocationEvent onLocationPicked = new LocationEvent();

        public SiteInfo Selected { get; private set; }
        public SiteInfo Hovered { get; private set; }

        class Pin
        {
            public SiteInfo site;
            public Transform root, inner, halo;
            public MaterialPropertyBlock haloBlock;
            public MeshRenderer haloRenderer;
        }

        readonly List<Pin> pins = new List<Pin>();
        readonly List<SiteInfo> sites = new List<SiteInfo>();
        public IReadOnlyList<SiteInfo> Sites => sites;
        GlobeView globe;
        Mesh disc;
        Material ringMat, innerMat, haloMat;
        bool wasFlat;
        static readonly Quaternion FlatPinRotation = Quaternion.FromToRotation(Vector3.up, Vector3.back); // disc faces the viewer
        static readonly int ColorId = Shader.PropertyToID("_Color");

        public static Color ColorOf(ChangeType t) => t switch
        {
            ChangeType.Agriculture => new Color(0.18f, 0.75f, 0.45f),
            ChangeType.Water => new Color(0.23f, 0.55f, 1f),
            ChangeType.Fire => new Color(1f, 0.68f, 0.17f),
            ChangeType.Deformation => new Color(1f, 0.36f, 0.42f),
            _ => new Color(1f, 0.82f, 0.88f),
        };

        public static string LabelOf(ChangeType t) => t switch
        {
            ChangeType.Agriculture => "Crops & farmland",
            ChangeType.Water => "Floods & wetlands",
            ChangeType.Fire => "Fire & forest loss",
            ChangeType.Deformation => "Ground motion",
            _ => "Ice & glaciers",
        };

        void Start()
        {
            globe = GetComponent<GlobeView>();
            disc = GeoMath.BuildDisc();
            ringMat = MakeMat(Color.white, 3001);
            innerMat = MakeMat(Color.white, 3002);
            haloMat = MakeMat(Color.white, 3000);

            foreach (var st in StoryDatabase.All)
                sites.Add(new SiteInfo
                {
                    id = st.id, name = st.region, lat = st.lat, lon = st.lon, story = st.summary,
                    data = st, color = st.ThemeColor, label = string.IsNullOrEmpty(st.themeLabel) ? st.kindLabel : st.themeLabel,
                });
            foreach (var s in sites) pins.Add(CreatePin(s));
        }

        Material MakeMat(Color c, int queue)
        {
            var m = GlobeView.CreateMaterial("Nisar/UnlitColor");
            if (m == null) return null;
            m.SetColor(ColorId, c);
            m.renderQueue = queue;
            return m;
        }

        GameObject CreateDisc(string name, Transform parent, Material mat)
        {
            return GlobeView.CreateMeshObject(name, parent, disc, mat);
        }

        Pin CreatePin(SiteInfo s)
        {
            var root = new GameObject("Pin " + s.name).transform;
            root.SetParent(globe.Spin, false);
            Vector3 d = GeoMath.LatLonToDir(s.lat, s.lon);
            root.localPosition = d * globe.radius * 1.003f;
            root.localRotation = Quaternion.FromToRotation(Vector3.up, d);
            root.localScale = Vector3.one * globe.radius * pinSize;

            CreateDisc("Ring", root, ringMat);
            var inner = CreateDisc("Dot", root, innerMat).transform;
            inner.localPosition = new Vector3(0f, 0.02f, 0f);
            inner.localScale = Vector3.one * 0.68f;
            var block = new MaterialPropertyBlock();
            block.SetColor(ColorId, s.Color);
            inner.GetComponent<MeshRenderer>().SetPropertyBlock(block);

            var halo = CreateDisc("Halo", root, haloMat).transform;
            var haloBlock = new MaterialPropertyBlock();
            var haloRenderer = halo.GetComponent<MeshRenderer>();
            haloRenderer.enabled = false;

            return new Pin { site = s, root = root, inner = inner, halo = halo, haloBlock = haloBlock, haloRenderer = haloRenderer };
        }

        /// Places a surface marker on the sphere or, while flattened, on the map (hidden outside the window).
        void PlaceOnSurface(Transform tr, float lat, float lon, float lift)
        {
            Vector3 d = GeoMath.LatLonToDir(lat, lon);
            tr.localPosition = globe.SurfaceLocal(lat, lon, lift);
            tr.localRotation = globe.SurfaceRotationLocal(Quaternion.FromToRotation(Vector3.up, d), FlatPinRotation);
        }

        void Update()
        {
            float t = Time.time;
            bool flat = globe.Flatten > 0f;
            if (flat || wasFlat)
            {
                foreach (var p in pins)
                {
                    PlaceOnSurface(p.root, p.site.lat, p.site.lon, 0.003f);
                    p.root.gameObject.SetActive(globe.Flatten < 0.5f || globe.InMapWindow(p.site.lat, p.site.lon, 0.01f));
                }
            }
            wasFlat = flat;

            foreach (var p in pins)
            {
                bool sel = p.site == Selected;
                bool hov = p.site == Hovered;
                float target = sel ? 1.35f : hov ? 1.2f : 1f;
                p.inner.localScale = Vector3.one * Mathf.Lerp(p.inner.localScale.x / 0.68f, target, 10f * Time.deltaTime) * 0.68f;

                p.haloRenderer.enabled = sel || hov;
                if (!p.haloRenderer.enabled) continue;
                float phase = sel ? Mathf.Repeat(t * 0.8f, 1f) : 0.35f;
                p.halo.localScale = Vector3.one * Mathf.Lerp(1.1f, 2.8f, phase);
                Color c = p.site.Color;
                c.a = (sel ? 0.6f : 0.3f) * (1f - phase);
                p.haloBlock.SetColor(ColorId, c);
                p.haloRenderer.SetPropertyBlock(p.haloBlock);
            }
        }

        public SiteInfo FindNearest(float lat, float lon, out float km)
        {
            SiteInfo best = null;
            km = float.MaxValue;
            foreach (var s in sites)
            {
                float d = GeoMath.DistanceKm(lat, lon, s.lat, s.lon);
                if (d < km) { km = d; best = s; }
            }
            return best;
        }

        public SiteInfo SiteNear(float lat, float lon)
        {
            var s = FindNearest(lat, lon, out float km);
            float limit = selectRadiusKm;
            if (globe != null && globe.IsMap) // ~5 cm on the map, whatever the zoom
                limit = Mathf.Min(limit, 0.05f / (globe.radius * Mathf.Max(1f, globe.MapZoom)) * 6371f);
            return km <= limit ? s : null;
        }

        public void SetHover(SiteInfo s) => Hovered = s;

        /// Selects the story near (lat, lon); if there is none, nothing is marked.
        public void PickLocation(float lat, float lon)
        {
            var s = SiteNear(lat, lon);
            if (s != null)
            {
                Select(s);
                return;
            }
            Select(null);
            onLocationPicked.Invoke(lat, lon);
        }

        public void Select(SiteInfo s)
        {
            Selected = s;
            globe.HoldIdle = s != null;
            if (s == null) return;
            globe.FocusOn(s.lat, s.lon);
            onSiteSelected.Invoke(s);
        }
    }
}
