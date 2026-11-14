using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Nisar.Globe
{
    /// The web map's "GUIDE" legend (bottom left): what each story colour means.
    /// Floats at the lower left of the globe / flat map. Created by StoryPresenter.
    public class MapGuide : MonoBehaviour
    {
        public const float WidthPx = 330f, HeightPx = 262f, MetresPerPx = 0.0009f;

        Vector3 anchorPos;
        Quaternion anchorRot = Quaternion.identity;
        bool placed;

        public void Build()
        {
            var font = CountryLabels.ResolveFont(null);
            var rounded = StoryPanel.RoundedSprite(64, 18);

            var canvas = gameObject.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            gameObject.AddComponent<CanvasScaler>().dynamicPixelsPerUnit = 4f;
            var root = (RectTransform)transform;
            root.sizeDelta = new Vector2(WidthPx, HeightPx);
            root.localScale = Vector3.one * MetresPerPx;

            Box(root, rounded, new Color(0.45f, 0.58f, 0.9f, 0.3f), 0);
            Box(root, rounded, new Color(0.04f, 0.06f, 0.12f, 0.92f), 2);

            Text(root, font, "GUIDE", 15, new Color(0.62f, 0.67f, 0.78f), new Vector2(22, -18), 3f, FontStyles.Bold);
            float y = -62;
            foreach (var (label, color) in StoryDatabase.ThemeLegend)
            {
                var sw = New("Swatch", root);
                sw.anchorMin = sw.anchorMax = new Vector2(0, 1);
                sw.pivot = new Vector2(0, 0.5f);
                sw.anchoredPosition = new Vector2(22, y);
                sw.sizeDelta = new Vector2(26, 26);
                var border = sw.gameObject.AddComponent<Image>();
                border.sprite = rounded; border.type = Image.Type.Sliced; border.color = Color.white; border.raycastTarget = false;
                var fill = New("Fill", sw);
                fill.anchorMin = Vector2.zero; fill.anchorMax = Vector2.one;
                fill.offsetMin = new Vector2(2, 2); fill.offsetMax = new Vector2(-2, -2);
                var fi = fill.gameObject.AddComponent<Image>();
                fi.sprite = rounded; fi.type = Image.Type.Sliced; fi.color = color; fi.raycastTarget = false;

                Text(root, font, label, 19, new Color(0.95f, 0.96f, 0.98f), new Vector2(62, y + 13), 0f, FontStyles.Normal);
                y -= 42;
            }
            // credit required by the map data's licence (detailed story maps)
            Text(root, font, "Map © OpenStreetMap, © CARTO", 13, new Color(0.62f, 0.67f, 0.78f), new Vector2(22, y + 10), 0f, FontStyles.Normal);
        }

        public void SetAnchor(Vector3 position, Quaternion rotation)
        {
            anchorPos = position;
            anchorRot = rotation;
            if (!placed) { transform.SetPositionAndRotation(position, rotation); placed = true; }
        }

        void Update()
        {
            if (!placed) return;
            float k = 1f - Mathf.Exp(-8f * Time.deltaTime);
            transform.SetPositionAndRotation(Vector3.Lerp(transform.position, anchorPos, k), Quaternion.Slerp(transform.rotation, anchorRot, k));
        }

        static RectTransform New(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        static void Box(RectTransform parent, Sprite sprite, Color color, float inset)
        {
            var rt = New("Box", parent);
            rt.anchorMin = Vector2.zero; rt.anchorMax = Vector2.one;
            rt.offsetMin = new Vector2(inset, inset); rt.offsetMax = new Vector2(-inset, -inset);
            var img = rt.gameObject.AddComponent<Image>();
            img.sprite = sprite; img.type = Image.Type.Sliced; img.color = color; img.raycastTarget = false;
        }

        static void Text(RectTransform parent, TMP_FontAsset font, string text, float size, Color color, Vector2 topLeft, float spacing, FontStyles style)
        {
            var rt = New("Text", parent);
            rt.anchorMin = rt.anchorMax = new Vector2(0, 1);
            rt.pivot = new Vector2(0, 1);
            rt.anchoredPosition = topLeft;
            rt.sizeDelta = new Vector2(WidthPx - topLeft.x - 12, 30);
            var t = rt.gameObject.AddComponent<TextMeshProUGUI>();
            if (font != null) t.font = font;
            t.text = text;
            t.fontSize = size;
            t.color = color;
            t.characterSpacing = spacing;
            t.fontStyle = style;
            t.textWrappingMode = TextWrappingModes.NoWrap;
            t.raycastTarget = false;
        }
    }
}
