using System;
using System.Collections.Generic;
using System.Globalization;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Nisar.Globe
{
    /// World-space info panel for one story, modelled on the web map's side panel: badge, headline, metric,
    /// observed/passes/area, radar image with a date stepper, an "over time" chart, measurements and the full text.
    /// Built in code with uGUI + TextMeshPro (crisp in the headset). Input comes from GlobeControllerInput:
    /// point + trigger to press buttons, trigger-drag or thumbstick to scroll.
    public class StoryPanel : MonoBehaviour
    {
        public const float WidthPx = 560f, HeightPx = 880f, MetresPerPx = 0.0009f;
        public static float WidthMetres => WidthPx * MetresPerPx;

        public StoryData Story { get; private set; }
        public bool Visible => Story != null && group != null && group.alpha > 0.05f;
        public event Action Closed;
        public event Action<StoryLayer, StoryFrame> FrameChanged;

        static readonly Color PanelBg = new Color(0.04f, 0.06f, 0.12f, 0.95f);
        static readonly Color CardBg = new Color(0.07f, 0.1f, 0.19f, 1f);
        static readonly Color Border = new Color(0.45f, 0.58f, 0.9f, 0.3f);
        static readonly Color Ink = new Color(0.95f, 0.96f, 0.98f);
        static readonly Color Body = new Color(0.84f, 0.87f, 0.93f);
        static readonly Color Muted = new Color(0.62f, 0.67f, 0.78f);
        static readonly Color Accent = new Color(0.33f, 0.58f, 1f);
        static readonly Color Gold = new Color(0.96f, 0.76f, 0.31f);
        static readonly Color ButtonBg = new Color(0.12f, 0.17f, 0.3f, 1f);
        static readonly Color ButtonHover = new Color(0.2f, 0.32f, 0.6f, 1f);

        class Btn
        {
            public RectTransform rt;
            public Action onClick;
            public Image bg;
            public Color normal, hover;
            public bool inScroll;
        }

        CanvasGroup group;
        RectTransform root, header, viewport, content;
        TMP_FontAsset font;
        Sprite rounded, pill;
        readonly List<Btn> buttons = new List<Btn>();
        Btn hovered;
        float scroll, scrollTarget, targetAlpha;
        Vector3 anchorPos;
        Quaternion anchorRot = Quaternion.identity;
        bool placed;

        // radar image state
        int layerIndex, frameIndex;
        bool playing;
        float playTimer;
        RawImage radarImage;
        LayoutElement radarSize;
        TextMeshProUGUI frameLabel, layerLabel, playLabel;
        readonly List<(Image bg, TextMeshProUGUI txt)> layerPills = new List<(Image, TextMeshProUGUI)>();

        // press / drag-to-scroll state
        Vector3 pressLocal;
        bool pressed, dragged;

        // ------------------------------------------------------------------ setup

        public void Build()
        {
            font = CountryLabels.ResolveFont(null);
            rounded = RoundedSprite(64, 18);
            pill = RoundedSprite(64, 31);

            var canvas = gameObject.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            gameObject.AddComponent<CanvasScaler>().dynamicPixelsPerUnit = 4f;
            group = gameObject.AddComponent<CanvasGroup>();
            group.alpha = 0f;
            root = (RectTransform)transform;
            root.sizeDelta = new Vector2(WidthPx, HeightPx);
            root.localScale = Vector3.one * MetresPerPx;

            Stretch(AddImage(NewRect("Border", root), rounded, Border).rectTransform, 0, 0, 0, 0);
            Stretch(AddImage(NewRect("Background", root), rounded, PanelBg).rectTransform, 2, 2, 2, 2);

            header = NewRect("Header", root);
            header.anchorMin = new Vector2(0, 1);
            header.anchorMax = new Vector2(1, 1);
            header.pivot = new Vector2(0.5f, 1);
            header.offsetMin = new Vector2(24, -74);
            header.offsetMax = new Vector2(-20, -20);
            var hl = header.gameObject.AddComponent<HorizontalLayoutGroup>();
            hl.spacing = 10;
            hl.childAlignment = TextAnchor.MiddleLeft;
            hl.childControlWidth = hl.childControlHeight = true;
            hl.childForceExpandWidth = hl.childForceExpandHeight = false;

            viewport = NewRect("Viewport", root);
            Stretch(viewport, 24, 18, 24, 84);
            viewport.gameObject.AddComponent<RectMask2D>();
            content = NewRect("Content", viewport);
            content.anchorMin = new Vector2(0, 1);
            content.anchorMax = new Vector2(1, 1);
            content.pivot = new Vector2(0.5f, 1);
            content.offsetMin = content.offsetMax = Vector2.zero;
            var vl = content.gameObject.AddComponent<VerticalLayoutGroup>();
            vl.spacing = 16;
            vl.childControlWidth = vl.childControlHeight = true;
            vl.childForceExpandWidth = true;
            vl.childForceExpandHeight = false;
            content.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;
        }

        /// Where the panel should float (it eases there).
        public void SetAnchor(Vector3 position, Quaternion rotation)
        {
            anchorPos = position;
            anchorRot = rotation;
            if (!placed) { transform.SetPositionAndRotation(position, rotation); placed = true; }
        }

        // ------------------------------------------------------------------ content

        public void Show(StoryData s)
        {
            if (root == null) Build();
            Story = s;
            targetAlpha = 1f;
            scroll = scrollTarget = 0f;
            layerIndex = frameIndex = 0;
            playing = false;
            buttons.Clear();
            hovered = null;
            layerPills.Clear();
            radarImage = null;
            ClearChildren(header);
            ClearChildren(content);

            Color cls = StoryDatabase.ClassColor(s.changeClass);

            // header: kind badge, sample tag, close button
            Badge(header, s.kindLabel, cls);
            if (s.isSample) Badge(header, "SAMPLE", Muted);
            var spacer = NewRect("Spacer", header).gameObject.AddComponent<LayoutElement>();
            spacer.flexibleWidth = 1;
            var close = PillButton(header, "X", () => { Hide(); Closed?.Invoke(); }, false);
            close.GetComponent<LayoutElement>().preferredWidth = 46;

            Txt(content, s.headline, 30, Ink, bold: true);
            Txt(content, $"{s.region} · {s.subtitle} · {GeoMath.Format(s.lat, s.lon)}", 16, Muted);

            MetricCard(s, cls);
            StatsRow(s);
            if (s.HasLayers) RadarCard(s);
            if (s.HasSeries) ChartCard(s);
            if (s.measurements != null && s.measurements.Length > 0) MeasurementsCard(s);

            Section("WHAT THE RADAR SAW", s.summary);
            if (s.causes != null && s.causes.Length > 0) Section("POSSIBLE CAUSES", "• " + string.Join("\n• ", s.causes));
            Section("WHY IT MATTERS", s.whyItMatters);
            Section("NEXT STEP", s.nextStep);
            Section("IN DETAIL", s.explanation + (s.aiGenerated ? "\n\n<i><size=13>This explanation was written with AI help from the measurements above.</size></i>" : ""));
            Section("CONFIDENCE", $"{Cap(s.confidence)} confidence" + (string.IsNullOrEmpty(s.confidenceNote) ? "" : $" · {s.confidenceNote}"));
            string sources = s.dataSource != null ? string.Join("\n", s.dataSource) : "";
            if (s.basemap != null && !string.IsNullOrEmpty(s.basemap.resource))
                sources += (sources.Length > 0 ? "\n" : "") + "Map: \u00a9 OpenStreetMap contributors, \u00a9 CARTO";
            Section("DATA SOURCE", sources);
            Txt(content, $"Published {Date(s.published)}" + (s.isSample ? " · Sample story with illustrative data" : " · NASA–ISRO NISAR"), 13, Muted);
            NewRect("BottomSpace", content).gameObject.AddComponent<LayoutElement>().preferredHeight = 8;

            if (s.HasLayers) ShowFrame();
            LayoutRebuilder.ForceRebuildLayoutImmediate(content);
        }

        public void Hide()
        {
            targetAlpha = 0f;
            playing = false;
        }

        void MetricCard(StoryData s, Color cls)
        {
            var card = Card(content, 22);
            Txt(card, s.metricLabel.ToUpperInvariant(), 13, Muted, spacing: 3);
            var row = Row(card, 14);
            string arrow = s.metricDirection == "upward" ? "↑" : s.metricDirection == "downward" ? "↓" : "→";
            Txt(row, arrow, 46, Accent, bold: true);
            string sign = s.metricValue > 0 && s.metricDirection == "upward" ? "+" : "";
            Txt(row, sign + Num(s.metricValue), 58, Ink, bold: true);
            Txt(row, s.metricUnit, 18, Ink).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            string dir = string.IsNullOrEmpty(s.metricDirection) ? "" : $"Direction: <b><color=#FFFFFF>{s.metricDirection}</color></b> · ";
            Txt(card, $"{dir}{s.periodLabel} · {Cap(s.confidence)} confidence", 14, Muted);
        }

        void StatsRow(StoryData s)
        {
            var row = Row(content, 10, expand: true);
            Stat(row, "OBSERVED", s.periodLabel);
            Stat(row, "RADAR PASSES", s.passes.ToString());
            Stat(row, "AREA", $"{Num(s.areaKm2)} km²");
        }

        void Stat(RectTransform parent, string caption, string value)
        {
            var c = Card(parent, 14);
            Txt(c, caption, 12, Muted, spacing: 2);
            Txt(c, value, 19, Ink, bold: true);
        }

        void RadarCard(StoryData s)
        {
            var card = Card(content, 18);
            var top = Row(card, 8);
            Txt(top, "RADAR IMAGE", 13, Muted, spacing: 3).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            if (s.layers.Length > 1)
            {
                for (int i = 0; i < s.layers.Length; i++)
                {
                    int li = i;
                    var b = PillButton(top, s.layers[i].shortLabel, () => { layerIndex = li; frameIndex = Mathf.Min(frameIndex, Story.layers[li].frames.Length - 1); ShowFrame(); }, true);
                    layerPills.Add((b.GetComponent<Image>(), b.GetComponentInChildren<TextMeshProUGUI>()));
                }
            }

            var imgRt = NewRect("Radar", card);
            radarImage = imgRt.gameObject.AddComponent<RawImage>();
            radarImage.raycastTarget = false;
            radarSize = imgRt.gameObject.AddComponent<LayoutElement>();
            radarSize.preferredHeight = 300;

            layerLabel = Txt(card, "", 13, Muted);
            var ctl = Row(card, 8);
            PillButton(ctl, "‹ Prev", () => Step(-1), true);
            frameLabel = Txt(ctl, "", 18, Gold, bold: true);
            frameLabel.alignment = TextAlignmentOptions.Center;
            frameLabel.gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            PillButton(ctl, "Next ›", () => Step(1), true);
            var play = PillButton(ctl, "Play", () => { playing = !playing; playTimer = 0f; playLabel.text = playing ? "Pause" : "Play"; }, true);
            playLabel = play.GetComponentInChildren<TextMeshProUGUI>();
        }

        void Step(int d)
        {
            var frames = Story.layers[layerIndex].frames;
            if (frames.Length == 0) return;
            frameIndex = (frameIndex + d + frames.Length) % frames.Length;
            ShowFrame();
        }

        void ShowFrame()
        {
            if (Story == null || !Story.HasLayers || radarImage == null) return;
            var layer = Story.layers[layerIndex];
            var frame = layer.frames.Length > 0 ? layer.frames[Mathf.Clamp(frameIndex, 0, layer.frames.Length - 1)] : null;
            var tex = frame != null ? Resources.Load<Texture2D>(frame.resource) : null;
            radarImage.texture = tex;
            radarImage.color = tex != null ? Color.white : new Color(1, 1, 1, 0);
            float w = WidthPx - 48 - 36;
            radarSize.preferredHeight = tex != null ? Mathf.Min(380f, w * tex.height / tex.width) : 40f;
            frameLabel.text = frame == null ? "No image" : $"{frame.label}  ({frameIndex + 1}/{layer.frames.Length})";
            layerLabel.text = layer.label;
            for (int i = 0; i < layerPills.Count; i++)
            {
                layerPills[i].bg.color = i == layerIndex ? Accent : ButtonBg;
                layerPills[i].txt.color = i == layerIndex ? Color.white : Body;
            }
            LayoutRebuilder.ForceRebuildLayoutImmediate(content);
            FrameChanged?.Invoke(layer, frame);
        }

        void ChartCard(StoryData s)
        {
            var card = Card(content, 18);
            var top = Row(card, 8);
            Txt(top, s.seriesLabel, 13, Muted, spacing: 2).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            var last = s.series[s.series.Length - 1];
            string sign = last.value > 0 ? "+" : "";
            Txt(top, $"{ShortDate(last.date)} · <b>{sign}{Num(last.value)}</b>", 14, Ink);

            var chartRt = NewRect("Chart", card);
            chartRt.gameObject.AddComponent<LayoutElement>().preferredHeight = 150;
            var chart = chartRt.gameObject.AddComponent<UILineChart>();
            chart.color = Accent;
            chart.raycastTarget = false;
            var vals = new float[s.series.Length];
            float min = float.MaxValue, max = float.MinValue;
            for (int i = 0; i < vals.Length; i++) { vals[i] = s.series[i].value; min = Mathf.Min(min, vals[i]); max = Mathf.Max(max, vals[i]); }
            chart.SetValues(vals);

            var axis = Row(card, 8);
            Txt(axis, ShortDate(s.series[0].date), 12, Muted).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            Txt(axis, $"range {Num(min)} to {Num(max)}", 12, Muted).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            var end = Txt(axis, ShortDate(last.date), 12, Muted);
            end.alignment = TextAlignmentOptions.Right;
        }

        void MeasurementsCard(StoryData s)
        {
            var card = Card(content, 18);
            Txt(card, "MEASUREMENTS", 13, Muted, spacing: 3);
            foreach (var m in s.measurements)
            {
                var row = Row(card, 10);
                Txt(row, m.label, 15, Muted).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
                var v = Txt(row, m.value, 15, Ink, bold: true);
                v.alignment = TextAlignmentOptions.Right;
            }
        }

        void Section(string title, string body)
        {
            if (string.IsNullOrEmpty(body)) return;
            var box = NewRect(title, content);
            var vl = box.gameObject.AddComponent<VerticalLayoutGroup>();
            vl.spacing = 6;
            vl.childControlWidth = vl.childControlHeight = true;
            vl.childForceExpandWidth = true;
            vl.childForceExpandHeight = false;
            Txt(box, title, 13, Accent, spacing: 3, bold: true);
            Txt(box, body, 17, Body);
        }

        // ------------------------------------------------------------------ input (called by GlobeControllerInput)

        /// Hit test against the panel; returns the world-space hit point.
        public bool Raycast(Ray ray, out Vector3 hit)
        {
            hit = default;
            if (!Visible || ray.direction == Vector3.zero) return false;
            var plane = new Plane(-transform.forward, transform.position);
            if (!plane.Raycast(ray, out float d)) return false;
            hit = ray.GetPoint(d);
            Vector2 l = root.InverseTransformPoint(hit);
            return root.rect.Contains(l);
        }

        public void Hover(Vector3 hit, bool onPanel)
        {
            hovered = onPanel ? ButtonAt(hit) : null;
            foreach (var b in buttons)
                if (b.bg != null && b.bg.color != Accent) b.bg.color = b == hovered ? b.hover : b.normal;
        }

        public void Press(Vector3 hit)
        {
            pressed = true;
            dragged = false;
            pressLocal = root.InverseTransformPoint(hit);
        }

        public void Drag(Vector3 hit)
        {
            if (!pressed) return;
            Vector3 l = root.InverseTransformPoint(hit);
            float dy = l.y - pressLocal.y;
            if (!dragged && Mathf.Abs(dy) > 12f) dragged = true;
            if (dragged)
            {
                ScrollBy(dy);
                pressLocal = l;
            }
        }

        public void Release(Vector3 hit)
        {
            if (pressed && !dragged) ButtonAt(hit)?.onClick?.Invoke();
            pressed = false;
        }

        /// Positive scrolls further down the content.
        public void ScrollBy(float px) => scrollTarget = Mathf.Clamp(scrollTarget + px, 0f, MaxScroll);

        float MaxScroll => content == null || viewport == null ? 0f : Mathf.Max(0f, content.rect.height - viewport.rect.height);

        Btn ButtonAt(Vector3 hit)
        {
            bool inView = viewport.rect.Contains((Vector2)viewport.InverseTransformPoint(hit));
            foreach (var b in buttons)
            {
                if (b.rt == null || (b.inScroll && !inView)) continue;
                if (b.rt.rect.Contains((Vector2)b.rt.InverseTransformPoint(hit))) return b;
            }
            return null;
        }

        void Update()
        {
            if (group == null) return;
            group.alpha = Mathf.MoveTowards(group.alpha, targetAlpha, Time.deltaTime * 4f);
            if (placed)
            {
                float k = 1f - Mathf.Exp(-8f * Time.deltaTime);
                transform.SetPositionAndRotation(Vector3.Lerp(transform.position, anchorPos, k), Quaternion.Slerp(transform.rotation, anchorRot, k));
            }
            scroll = Mathf.Lerp(scroll, scrollTarget, 1f - Mathf.Exp(-12f * Time.deltaTime));
            if (content != null) content.anchoredPosition = new Vector2(0f, scroll);

            if (playing && Story != null && Story.HasLayers)
            {
                playTimer += Time.deltaTime;
                if (playTimer > 1.1f) { playTimer = 0f; Step(1); }
            }
        }

        // ------------------------------------------------------------------ UI helpers

        static void ClearChildren(Transform t)
        {
            var old = new List<GameObject>();
            foreach (Transform c in t) old.Add(c.gameObject);
            foreach (var g in old)
            {
                g.transform.SetParent(null, false); // out of the layout right away; destroyed at end of frame
                Destroy(g);
            }
        }

        static RectTransform NewRect(string name, Transform parent)
        {
            var go = new GameObject(name, typeof(RectTransform));
            go.transform.SetParent(parent, false);
            return (RectTransform)go.transform;
        }

        static void Stretch(RectTransform rt, float left, float bottom, float right, float top)
        {
            rt.anchorMin = Vector2.zero;
            rt.anchorMax = Vector2.one;
            rt.offsetMin = new Vector2(left, bottom);
            rt.offsetMax = new Vector2(-right, -top);
        }

        static Image AddImage(RectTransform rt, Sprite sprite, Color c)
        {
            var img = rt.gameObject.AddComponent<Image>();
            img.sprite = sprite;
            img.type = Image.Type.Sliced;
            img.color = c;
            img.raycastTarget = false;
            return img;
        }

        TextMeshProUGUI Txt(Transform parent, string text, float size, Color color, bool bold = false, float spacing = 0f)
        {
            var rt = NewRect("Text", parent);
            var t = rt.gameObject.AddComponent<TextMeshProUGUI>();
            if (font != null) t.font = font;
            t.text = text ?? "";
            t.fontSize = size;
            t.color = color;
            t.fontStyle = bold ? FontStyles.Bold : FontStyles.Normal;
            t.characterSpacing = spacing;
            t.textWrappingMode = TextWrappingModes.Normal;
            t.richText = true;
            t.raycastTarget = false;
            return t;
        }

        RectTransform Card(Transform parent, int padding)
        {
            var outer = NewRect("Card", parent);
            AddImage(outer, rounded, Border);
            var ol = outer.gameObject.AddComponent<VerticalLayoutGroup>();
            ol.padding = new RectOffset(2, 2, 2, 2);
            ol.childControlWidth = ol.childControlHeight = true;
            ol.childForceExpandWidth = true;
            ol.childForceExpandHeight = false;

            var inner = NewRect("Inner", outer);
            AddImage(inner, rounded, CardBg);
            var vl = inner.gameObject.AddComponent<VerticalLayoutGroup>();
            vl.padding = new RectOffset(padding, padding, padding, padding);
            vl.spacing = 8;
            vl.childControlWidth = vl.childControlHeight = true;
            vl.childForceExpandWidth = true;
            vl.childForceExpandHeight = false;
            return inner;
        }

        static RectTransform Row(Transform parent, float spacing, bool expand = false)
        {
            var row = NewRect("Row", parent);
            var hl = row.gameObject.AddComponent<HorizontalLayoutGroup>();
            hl.spacing = spacing;
            hl.childAlignment = TextAnchor.MiddleLeft;
            hl.childControlWidth = hl.childControlHeight = true;
            hl.childForceExpandWidth = expand;
            hl.childForceExpandHeight = expand;
            return row;
        }

        void Badge(Transform parent, string text, Color c)
        {
            var b = NewRect("Badge", parent);
            AddImage(b, pill, new Color(c.r, c.g, c.b, 0.16f));
            var hl = b.gameObject.AddComponent<HorizontalLayoutGroup>();
            hl.padding = new RectOffset(16, 16, 8, 8);
            hl.childControlWidth = hl.childControlHeight = true;
            hl.childForceExpandWidth = hl.childForceExpandHeight = false;
            var t = Txt(b, text, 15, c, bold: true, spacing: 3);
            t.textWrappingMode = TextWrappingModes.NoWrap;
        }

        RectTransform PillButton(Transform parent, string label, Action onClick, bool inScroll)
        {
            var b = NewRect("Button", parent);
            var bg = AddImage(b, pill, ButtonBg);
            var hl = b.gameObject.AddComponent<HorizontalLayoutGroup>();
            hl.padding = new RectOffset(16, 16, 8, 8);
            hl.childAlignment = TextAnchor.MiddleCenter;
            hl.childControlWidth = hl.childControlHeight = true;
            hl.childForceExpandWidth = hl.childForceExpandHeight = false;
            b.gameObject.AddComponent<LayoutElement>().minHeight = 40;
            var t = Txt(b, label, 16, Body, bold: true);
            t.textWrappingMode = TextWrappingModes.NoWrap;
            t.alignment = TextAlignmentOptions.Center;
            buttons.Add(new Btn { rt = b, onClick = onClick, bg = bg, normal = ButtonBg, hover = ButtonHover, inScroll = inScroll });
            return b;
        }

        static Sprite RoundedSprite(int size, int radius)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Bilinear };
            var px = new Color32[size * size];
            for (int y = 0; y < size; y++)
            {
                for (int x = 0; x < size; x++)
                {
                    float cx = Mathf.Clamp(x + 0.5f, radius, size - radius);
                    float cy = Mathf.Clamp(y + 0.5f, radius, size - radius);
                    float d = Vector2.Distance(new Vector2(x + 0.5f, y + 0.5f), new Vector2(cx, cy));
                    byte a = (byte)(Mathf.Clamp01(radius - d + 0.5f) * 255);
                    px[y * size + x] = new Color32(255, 255, 255, a);
                }
            }
            tex.SetPixels32(px);
            tex.Apply();
            return Sprite.Create(tex, new Rect(0, 0, size, size), new Vector2(0.5f, 0.5f), 100f, 0, SpriteMeshType.FullRect,
                                 new Vector4(radius, radius, radius, radius));
        }

        // ------------------------------------------------------------------ formatting

        static string Num(float v)
        {
            float a = Mathf.Abs(v);
            string f = a >= 100f ? "0" : a >= 10f ? "0.#" : "0.##";
            return v.ToString(f, CultureInfo.InvariantCulture);
        }

        static string Cap(string s) => string.IsNullOrEmpty(s) ? "" : char.ToUpperInvariant(s[0]) + s.Substring(1);

        static string Date(string iso) =>
            DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d.ToString("d MMM yyyy", CultureInfo.InvariantCulture) : iso;

        static string ShortDate(string iso) =>
            DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d.ToString("d MMM", CultureInfo.InvariantCulture) : iso;
    }
}
