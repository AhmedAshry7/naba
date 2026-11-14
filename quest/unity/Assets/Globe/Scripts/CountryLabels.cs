using System;
using System.Collections.Generic;
using TMPro;
using UnityEngine;

namespace Nisar.Globe
{
    /// Places country names on the globe surface from Resources/country_labels.json.
    /// Labels lie flat on the sphere (north-up) and fade out toward the horizon.
    [RequireComponent(typeof(GlobeView))]
    public class CountryLabels : MonoBehaviour
    {
        [Tooltip("Optional. Falls back to the TextMeshPro default font (import TMP Essential Resources once).")]
        public TMP_FontAsset font;
        [Tooltip("Natural Earth LABELRANK: 2 = big countries only, 6 = most countries.")]
        [Range(1, 10)] public int maxRank = 4;
        public Color color = new Color(0.78f, 0.80f, 0.86f, 0.9f);
        public float sizeScale = 1f;
        public float lift = 0.004f;

        [Serializable] class LabelData { public string name; public float lat; public float lon; public int rank; }
        [Serializable] class LabelFile { public LabelData[] labels; }

        class Item { public TextMeshPro tmp; public MeshRenderer renderer; public float lat, lon; public Quaternion sphereRot; public float alpha = -1f; }

        readonly List<Item> items = new List<Item>();
        GlobeView globe;
        bool wasFlat;

        void Start()
        {
            globe = GetComponent<GlobeView>();
            var json = Resources.Load<TextAsset>("country_labels");
            var f = ResolveFont(font);
            if (json == null || f == null) return;

            foreach (var l in JsonUtility.FromJson<LabelFile>(json.text).labels)
            {
                if (l.rank > maxRank) continue;
                items.Add(Create(l, f));
            }
        }

        Item Create(LabelData l, TMP_FontAsset f)
        {
            var go = new GameObject("Label " + l.name);
            go.transform.SetParent(globe.Spin, false);
            Vector3 d = GeoMath.LatLonToDir(l.lat, l.lon);
            go.transform.localPosition = d * globe.radius * (1f + lift);
            go.transform.localRotation = Quaternion.LookRotation(-d, GeoMath.North(d));
            float h = globe.radius * sizeScale * (l.rank <= 2 ? 0.034f : l.rank <= 3 ? 0.029f : l.rank <= 4 ? 0.024f : 0.02f);
            go.transform.localScale = Vector3.one * h;

            var tmp = go.AddComponent<TextMeshPro>();
            tmp.font = f;
            tmp.fontSize = 10f;
            tmp.text = l.name;
            tmp.fontStyle = FontStyles.Bold;
            tmp.characterSpacing = 4f;
            tmp.alignment = TextAlignmentOptions.Center;
            tmp.textWrappingMode = TextWrappingModes.Normal;
            tmp.color = color;
            tmp.rectTransform.sizeDelta = new Vector2(9f, 4f);

            var mr = go.GetComponent<MeshRenderer>();
            mr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            mr.receiveShadows = false;
            return new Item { tmp = tmp, renderer = mr, lat = l.lat, lon = l.lon, sphereRot = go.transform.localRotation };
        }

        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam == null) return;
            Vector3 camPos = cam.transform.position;

            // Follow the surface while the globe is (or was just) flattened into a map.
            bool flat = globe.Flatten > 0f;
            if (flat || wasFlat)
            {
                foreach (var it in items)
                {
                    Transform lt = it.tmp.transform;
                    lt.localPosition = globe.SurfaceLocal(it.lat, it.lon, lift);
                    lt.localRotation = globe.SurfaceRotationLocal(it.sphereRot, Quaternion.identity);
                }
            }
            wasFlat = flat;

            foreach (var it in items)
            {
                Transform t = it.tmp.transform;
                Vector3 normal = -t.forward;
                float facing = Vector3.Dot(normal, (camPos - t.position).normalized);
                float a = Mathf.SmoothStep(0f, 1f, Mathf.InverseLerp(0.05f, 0.35f, facing));
                if (globe.Flatten > 0.5f && !globe.InMapWindow(it.lat, it.lon, 0.03f)) a = 0f;
                if (Mathf.Abs(a - it.alpha) < 0.03f) continue;
                it.alpha = a;
                it.renderer.enabled = a > 0.01f;
                if (it.renderer.enabled) it.tmp.alpha = a;
            }
        }

        public static TMP_FontAsset ResolveFont(TMP_FontAsset preferred)
        {
            if (preferred != null) return preferred;
            TMP_FontAsset f = null;
            try { f = TMP_Settings.defaultFontAsset; } catch (Exception) { }
            if (f == null)
                Debug.LogWarning("[Globe] No TextMeshPro font. Run Window > TextMeshPro > Import TMP Essential Resources, or assign a font.");
            return f;
        }
    }
}
