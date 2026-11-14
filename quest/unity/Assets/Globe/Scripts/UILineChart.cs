using UnityEngine;
using UnityEngine.UI;

namespace Nisar.Globe
{
    /// Minimal UI line chart: a filled area under a polyline, with a dot on the latest value.
    public class UILineChart : MaskableGraphic
    {
        public float[] values;
        public float thickness = 3f;
        public Color fillColor = new Color(0.3f, 0.55f, 1f, 0.22f);

        public void SetValues(float[] v)
        {
            values = v;
            SetVerticesDirty();
        }

        protected override void OnPopulateMesh(VertexHelper vh)
        {
            vh.Clear();
            if (values == null || values.Length < 2) return;
            Rect r = rectTransform.rect;
            float min = float.MaxValue, max = float.MinValue;
            foreach (var v in values) { min = Mathf.Min(min, v); max = Mathf.Max(max, v); }
            if (max - min < 1e-6f) { max += 1f; min -= 1f; }
            float pad = (max - min) * 0.12f;
            min -= pad; max += pad;

            var pts = new Vector2[values.Length];
            for (int i = 0; i < values.Length; i++)
                pts[i] = new Vector2(r.xMin + r.width * i / (values.Length - 1f),
                                     r.yMin + r.height * (values[i] - min) / (max - min));

            // filled area, fading toward the bottom
            Color top = fillColor, bottom = new Color(fillColor.r, fillColor.g, fillColor.b, 0f);
            for (int i = 0; i < pts.Length - 1; i++)
            {
                int b = vh.currentVertCount;
                vh.AddVert(new Vector3(pts[i].x, r.yMin), bottom, Vector4.zero);
                vh.AddVert(pts[i], top, Vector4.zero);
                vh.AddVert(pts[i + 1], top, Vector4.zero);
                vh.AddVert(new Vector3(pts[i + 1].x, r.yMin), bottom, Vector4.zero);
                vh.AddTriangle(b, b + 1, b + 2);
                vh.AddTriangle(b, b + 2, b + 3);
            }

            // line
            for (int i = 0; i < pts.Length - 1; i++)
            {
                Vector2 d = (pts[i + 1] - pts[i]).normalized;
                Vector2 n = new Vector2(-d.y, d.x) * thickness * 0.5f;
                int b = vh.currentVertCount;
                vh.AddVert(pts[i] - n, color, Vector4.zero);
                vh.AddVert(pts[i] + n, color, Vector4.zero);
                vh.AddVert(pts[i + 1] + n, color, Vector4.zero);
                vh.AddVert(pts[i + 1] - n, color, Vector4.zero);
                vh.AddTriangle(b, b + 1, b + 2);
                vh.AddTriangle(b, b + 2, b + 3);
            }

            // dot on the latest value
            Vector2 last = pts[pts.Length - 1];
            const int seg = 16;
            float rad = thickness * 2.2f;
            int c = vh.currentVertCount;
            vh.AddVert(last, color, Vector4.zero);
            for (int i = 0; i <= seg; i++)
            {
                float a = i * Mathf.PI * 2f / seg;
                vh.AddVert(last + new Vector2(Mathf.Cos(a), Mathf.Sin(a)) * rad, color, Vector4.zero);
                if (i > 0) vh.AddTriangle(c, c + i, c + i + 1);
            }
        }
    }
}
