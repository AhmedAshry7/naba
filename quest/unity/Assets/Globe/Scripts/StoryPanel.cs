using System;
using System.Collections.Generic;
using System.Globalization;
using TMPro;
using UnityEngine;
using UnityEngine.UI;

namespace Nisar.Globe
{
    /// World-space story panel, laid out like the web app's (frontend/src/components/StoryPanel.tsx):
    ///   header: theme badge + close, headline, region · subtitle · coordinates
    ///   scrolling body: the plain-language paragraphs, the metric line, Observed / Radar passes / Area,
    ///                   then the rest of the story (everything comes from changes.geojson)
    ///   footer: the time control: the story's radar passes (its series) with play, or the earthquake's before/after switch.
    /// Moving the time control raises StepChanged so the map shows that step's highlighted areas.
    /// Built in code with uGUI + TextMeshPro. Input comes from GlobeControllerInput (point + trigger,
    /// trigger-drag or thumbstick to scroll, drag the slider).
    public class StoryPanel : MonoBehaviour
    {
        public const float WidthPx = 560f, HeightPx = 900f, MetresPerPx = 0.0009f;
        public static float WidthMetres => WidthPx * MetresPerPx;

        public StoryData Story { get; private set; }
        public bool Visible => Story != null && group != null && group.alpha > 0.05f;
        public event Action Closed;
        /// The time step the map should show (null: no steps, show the story zones).
        public event Action<StoryFrame> StepChanged;

        // web app palette (tailwind.config.js / index.css)
        static readonly Color PanelBg = new Color(0.02f, 0.047f, 0.11f, 0.97f);
        static readonly Color CardBg = new Color(0.055f, 0.09f, 0.17f, 1f);
        static readonly Color Line = new Color(0.19f, 0.26f, 0.42f, 0.75f);
        static readonly Color Ink = new Color(0.95f, 0.96f, 0.98f);
        static readonly Color Body = new Color(0.88f, 0.9f, 0.95f);
        static readonly Color Sub = new Color(0.6f, 0.66f, 0.78f);
        static readonly Color BrandBlue = new Color(0.043f, 0.31f, 0.70f);
        static readonly Color Gold = new Color(0.95f, 0.75f, 0.32f);
        static readonly Color ButtonBg = new Color(0.1f, 0.15f, 0.27f, 1f);
        static readonly Color ButtonHover = new Color(0.17f, 0.26f, 0.48f, 1f);

        class Btn
        {
            public RectTransform rt;
            public Action onClick;
            public Image bg;
            public Color normal, hover;
            public bool inScroll, enabled = true;
        }

        CanvasGroup group;
        RectTransform root, header, footer, viewport, content;
        TMP_FontAsset font, display;
        Sprite rounded, pill, playIcon, pauseIcon;
        readonly List<Btn> buttons = new List<Btn>();
        Btn hovered;
        float scroll, scrollTarget, targetAlpha;
        Vector3 anchorPos;
        Quaternion anchorRot = Quaternion.identity;
        bool placed;

        // time control
        StoryFrame[] steps;
        int stepIndex;
        bool playing;
        float playTimer;
        RectTransform sliderTrack, sliderKnob, switchKnob;
        Image switchBg, playImage;
        TextMeshProUGUI stepLabel, stepDetail, beforeLabel, afterLabel;
        RectTransform timeCard;


        // press / drag state
        Vector3 pressLocal;
        bool pressed, dragged, draggingSlider;

        // ------------------------------------------------------------------ setup

        public void Build()
        {
            font = CountryLabels.ResolveFont(null);
            display = DisplayFont(font);
            rounded = RoundedSprite(64, 18);
            pill = RoundedSprite(64, 31);
            playIcon = IconSprite(true);
            pauseIcon = IconSprite(false);

            var canvas = gameObject.AddComponent<Canvas>();
            canvas.renderMode = RenderMode.WorldSpace;
            gameObject.AddComponent<CanvasScaler>().dynamicPixelsPerUnit = 4f;
            group = gameObject.AddComponent<CanvasGroup>();
            group.alpha = 0f;
            root = (RectTransform)transform;
            root.sizeDelta = new Vector2(WidthPx, HeightPx);
            root.localScale = Vector3.one * MetresPerPx;

            Stretch(AddImage(NewRect("Border", root), rounded, Line).rectTransform, 0, 0, 0, 0);
            Stretch(AddImage(NewRect("Background", root), rounded, PanelBg).rectTransform, 2, 2, 2, 2);

            header = Stack(NewRect("Header", root), new RectOffset(26, 22, 22, 10), 8);
            header.anchorMin = new Vector2(0, 1);
            header.anchorMax = new Vector2(1, 1);
            header.pivot = new Vector2(0.5f, 1);
            header.sizeDelta = Vector2.zero; // exactly the panel's width
            header.anchoredPosition = Vector2.zero;
            header.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;

            footer = Stack(NewRect("Footer", root), new RectOffset(22, 22, 18, 22), 12);
            footer.anchorMin = new Vector2(0, 0);
            footer.anchorMax = new Vector2(1, 0);
            footer.pivot = new Vector2(0.5f, 0);
            footer.sizeDelta = Vector2.zero; // exactly the panel's width
            footer.anchoredPosition = Vector2.zero;
            footer.gameObject.AddComponent<ContentSizeFitter>().verticalFit = ContentSizeFitter.FitMode.PreferredSize;

            viewport = NewRect("Viewport", root);
            Stretch(viewport, 26, 200, 22, 200);
            viewport.gameObject.AddComponent<RectMask2D>();
            content = Stack(NewRect("Content", viewport), new RectOffset(0, 4, 6, 18), 14);
            content.anchorMin = new Vector2(0, 1);
            content.anchorMax = new Vector2(1, 1);
            content.pivot = new Vector2(0.5f, 1);
            content.offsetMin = content.offsetMax = Vector2.zero;
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
            playing = false;
            buttons.Clear();
            hovered = null;
            sliderTrack = sliderKnob = switchKnob = timeCard = null;
            stepDetail = stepLabel = null;
            ClearChildren(header);
            ClearChildren(content);
            ClearChildren(footer);

            Color theme = s.ThemeColor;

            // ---- header
            var top = Row(header, 10);
            Badge(top, s.kindLabel, theme);
            NewRect("Spacer", top).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            var close = PillButton(top, "×", () => { Hide(); Closed?.Invoke(); }, false, 26);
            close.GetComponent<LayoutElement>().preferredWidth = 46;
            var title = Txt(header, s.headline, 34, Ink);
            title.font = display;
            title.lineSpacing = -8;
            Txt(header, $"{s.region} · {s.subtitle} · {Coords(s.lat, s.lon)}", 16, Sub);

            // ---- scrolling body
            if (s.paragraphs != null)
                foreach (var p in s.paragraphs) Txt(content, p, 17, Body).lineSpacing = 8;
            if (!string.IsNullOrEmpty(s.metricLine)) Txt(content, s.metricLine, 15, theme, bold: true);
            var stats = Row(content, 10, expand: true);
            Stat(stats, "OBSERVED", s.observedLabel);
            Stat(stats, "RADAR PASSES", s.passes.ToString(CultureInfo.InvariantCulture));
            Stat(stats, "AREA", s.areaLabel);

            // ---- footer: time control
            AddFooterLine();
            steps = s.highlights?.frames;
            if (steps != null && steps.Length > 0)
            {
                stepIndex = Mathf.Clamp(s.highlights.defaultIndex, 0, steps.Length - 1);
                if (s.highlights.kind == "quake") QuakeSwitch(s);
                else if (steps.Length > 1) SliderCard(s.highlights.title);
            }

            LayoutRebuilder.ForceRebuildLayoutImmediate(header);
            LayoutRebuilder.ForceRebuildLayoutImmediate(footer);
            viewport.offsetMax = new Vector2(-22, -header.rect.height);
            viewport.offsetMin = new Vector2(26, footer.rect.height);
            LayoutRebuilder.ForceRebuildLayoutImmediate(content);

            ApplyStep();
        }

        public void Hide()
        {
            targetAlpha = 0f;
            playing = false;
        }

        void Stat(RectTransform parent, string caption, string value)
        {
            var c = Card(parent, 12);
            Txt(c, caption, 12, Sub, spacing: 2, bold: true);
            Txt(c, value, 17, Ink, bold: true);
        }

        void AddFooterLine()
        {
            var line = NewRect("TopLine", footer);
            line.gameObject.AddComponent<LayoutElement>().ignoreLayout = true;
            line.anchorMin = new Vector2(0, 1);
            line.anchorMax = new Vector2(1, 1);
            line.pivot = new Vector2(0.5f, 1);
            line.sizeDelta = new Vector2(0, 2);
            line.anchoredPosition = Vector2.zero;
            line.gameObject.AddComponent<Image>().color = Line;
        }

        // ---- time control: month / radar-pass slider (TimeSlider.tsx SliderCard)

        void SliderCard(string title)
        {
            var card = Card(footer, 14);
            timeCard = card;
            var row = Row(card, 14);

            var play = NewRect("Play", row);
            var pe = play.gameObject.AddComponent<LayoutElement>();
            pe.preferredWidth = pe.minWidth = 46;
            pe.preferredHeight = pe.minHeight = 46;
            var bg = AddImage(play, pill, BrandBlue);
            var icon = NewRect("Icon", play);
            icon.sizeDelta = new Vector2(18, 18);
            playImage = icon.gameObject.AddComponent<Image>();
            playImage.sprite = playIcon;
            playImage.raycastTarget = false;
            buttons.Add(new Btn { rt = play, bg = bg, normal = BrandBlue, hover = new Color(0.04f, 0.25f, 0.56f), onClick = TogglePlay });

            var col = Stack(NewRect("Column", row), new RectOffset(0, 0, 0, 0), 4);
            col.gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            var tr = Row(col, 8);
            Txt(tr, title, 13, Sub, spacing: 2, bold: true).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            stepLabel = Txt(tr, "", 22, Gold);
            stepLabel.font = display;
            stepLabel.textWrappingMode = TextWrappingModes.NoWrap;

            sliderTrack = NewRect("Slider", col);
            sliderTrack.gameObject.AddComponent<LayoutElement>().preferredHeight = 30;
            var rail = NewRect("Rail", sliderTrack);
            rail.anchorMin = new Vector2(0, 0.5f);
            rail.anchorMax = new Vector2(1, 0.5f);
            rail.sizeDelta = new Vector2(0, 6);
            AddImage(rail, pill, Line);
            sliderKnob = NewRect("Knob", sliderTrack);
            sliderKnob.anchorMin = sliderKnob.anchorMax = new Vector2(0, 0.5f);
            sliderKnob.sizeDelta = new Vector2(26, 26);
            AddImage(sliderKnob, pill, new Color(0.1f, 0.08f, 0.02f));
            var kf = NewRect("Fill", sliderKnob);
            Stretch(kf, 3, 3, 3, 3);
            AddImage(kf, pill, Gold);

            var labels = Row(col, 8);
            Txt(labels, steps[0].label, 13, Sub).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            Txt(labels, steps[steps.Length - 1].label, 13, Sub).alignment = TextAlignmentOptions.Right;
            stepDetail = Txt(col, "", 14, Story.ThemeColor, bold: true);
        }

        // ---- time control: earthquake before / after (TimeSlider.tsx QuakeSwitch)

        void QuakeSwitch(StoryData s)
        {
            var card = Card(footer, 14);
            timeCard = card;
            var tr = Row(card, 8);
            Txt(tr, s.highlights.title, 13, Sub, spacing: 2, bold: true).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            stepLabel = Txt(tr, "", 22, Gold);
            stepLabel.font = display;
            stepLabel.textWrappingMode = TextWrappingModes.NoWrap;

            var mid = Row(card, 14);
            mid.GetComponent<HorizontalLayoutGroup>().childAlignment = TextAnchor.MiddleCenter;
            beforeLabel = Txt(mid, "Before", 15, Ink, bold: true);
            var sw = NewRect("Switch", mid);
            var se = sw.gameObject.AddComponent<LayoutElement>();
            se.preferredWidth = se.minWidth = 64;
            se.preferredHeight = se.minHeight = 32;
            switchBg = AddImage(sw, pill, CardBg);
            switchKnob = NewRect("Knob", sw);
            switchKnob.anchorMin = switchKnob.anchorMax = new Vector2(0, 0.5f);
            switchKnob.sizeDelta = new Vector2(24, 24);
            AddImage(switchKnob, pill, Color.white);
            buttons.Add(new Btn { rt = sw, bg = null, onClick = () => { stepIndex = stepIndex == 0 ? 1 : 0; ApplyStep(); } });
            afterLabel = Txt(mid, "After", 15, Ink, bold: true);

            var bottom = Row(card, 8);
            Txt(bottom, FormatShort(s.periodStart), 13, Sub).gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            if (!string.IsNullOrEmpty(s.eventDate))
            {
                var ev = Txt(bottom, $"{FormatShort(s.eventDate)} · earthquake", 13, Ink, bold: true);
                ev.alignment = TextAlignmentOptions.Center;
                ev.gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
            }
            var end = Txt(bottom, FormatShort(s.periodEnd), 13, Sub);
            end.alignment = TextAlignmentOptions.Right;
            end.gameObject.AddComponent<LayoutElement>().flexibleWidth = 1;
        }

        void TogglePlay()
        {
            playing = !playing;
            playTimer = 0f;
            if (playImage != null) playImage.sprite = playing ? pauseIcon : playIcon;
        }

        /// Updates the slider / switch to `stepIndex` and tells the map.
        void ApplyStep()
        {
            StoryFrame step = steps != null && steps.Length > 0 ? steps[Mathf.Clamp(stepIndex, 0, steps.Length - 1)] : null;
            if (step != null && stepLabel != null)
                stepLabel.text = Story.highlights.kind == "quake" ? FormatDate(step.date) : step.label;
            if (step != null && stepDetail != null)
            {
                stepDetail.text = step.detail;
                stepDetail.color = step.active ? Story.ThemeColor : Sub; // grey when the event is not happening
            }
            if (sliderKnob != null && steps.Length > 1)
            {
                float w = sliderTrack.rect.width > 1f ? sliderTrack.rect.width : WidthPx - 160f;
                sliderKnob.anchoredPosition = new Vector2(w * stepIndex / (steps.Length - 1f), 0f);
            }
            if (switchKnob != null)
            {
                bool after = stepIndex >= 1;
                switchKnob.anchoredPosition = new Vector2(after ? 48f : 16f, 0f);
                switchBg.color = after ? Story.ThemeColor : CardBg;
                beforeLabel.color = after ? Sub : Ink;
                afterLabel.color = after ? Ink : Sub;
            }
            StepChanged?.Invoke(step);
        }

        void SetStepFromHit(Vector3 hit)
        {
            if (sliderTrack == null || steps == null || steps.Length < 2) return;
            Vector3 l = sliderTrack.InverseTransformPoint(hit);
            float t = Mathf.InverseLerp(sliderTrack.rect.xMin, sliderTrack.rect.xMax, l.x);
            int i = Mathf.RoundToInt(t * (steps.Length - 1));
            if (i == stepIndex) return;
            stepIndex = i;
            if (playing) TogglePlay();
            ApplyStep();
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
            {
                if (b.bg == null || !b.enabled) continue;
                b.bg.color = b == hovered ? b.hover : b.normal;
            }
        }

        public void Press(Vector3 hit)
        {
            pressed = true;
            dragged = false;
            pressLocal = root.InverseTransformPoint(hit);
            draggingSlider = OnSlider(hit);
            if (draggingSlider) SetStepFromHit(hit);
        }

        public void Drag(Vector3 hit)
        {
            if (!pressed) return;
            if (draggingSlider)
            {
                SetStepFromHit(hit);
                return;
            }
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
            if (pressed && !dragged && !draggingSlider)
            {
                var b = ButtonAt(hit);
                if (b != null && b.enabled) b.onClick?.Invoke();
            }
            pressed = false;
            draggingSlider = false;
        }

        /// Steps the time control by `d` (thumbstick left / right while pointing at the panel).
        public void StepBy(int d)
        {
            if (steps == null || steps.Length < 2) return;
            stepIndex = Mathf.Clamp(stepIndex + d, 0, steps.Length - 1);
            if (playing) TogglePlay();
            ApplyStep();
        }

        /// Positive scrolls further down the content.
        public void ScrollBy(float px) => scrollTarget = Mathf.Clamp(scrollTarget + px, 0f, MaxScroll);

        float MaxScroll => content == null || viewport == null ? 0f : Mathf.Max(0f, content.rect.height - viewport.rect.height);

        bool OnSlider(Vector3 hit)
        {
            if (sliderTrack == null) return false;
            Vector2 l = sliderTrack.InverseTransformPoint(hit);
            var r = sliderTrack.rect;
            return l.x >= r.xMin - 24 && l.x <= r.xMax + 24 && l.y >= r.yMin - 24 && l.y <= r.yMax + 24;
        }

        Btn ButtonAt(Vector3 hit)
        {
            bool inView = viewport.rect.Contains((Vector2)viewport.InverseTransformPoint(hit));
            foreach (var b in buttons)
            {
                if (b.rt == null || !b.rt.gameObject.activeInHierarchy || (b.inScroll && !inView)) continue;
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

            // play through the steps, wrapping back to the first (TimeSlider.tsx STEP_MS = 1200)
            if (playing && steps != null && steps.Length > 1)
            {
                playTimer += Time.deltaTime;
                if (playTimer >= 1.2f)
                {
                    playTimer = 0f;
                    stepIndex = (stepIndex + 1) % steps.Length;
                    ApplyStep();
                }
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

        static RectTransform Stack(RectTransform rt, RectOffset padding, float spacing)
        {
            var vl = rt.gameObject.AddComponent<VerticalLayoutGroup>();
            vl.padding = padding;
            vl.spacing = spacing;
            vl.childControlWidth = vl.childControlHeight = true;
            vl.childForceExpandWidth = true;
            vl.childForceExpandHeight = false;
            return rt;
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
            AddImage(outer, rounded, Line);
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
            AddImage(b, pill, new Color(c.r, c.g, c.b, 0.4f));
            var inner = NewRect("Fill", b);
            Stretch(inner, 2, 2, 2, 2);
            AddImage(inner, pill, Color.Lerp(PanelBg, c, 0.16f));
            inner.gameObject.AddComponent<LayoutElement>().ignoreLayout = true;
            var hl = b.gameObject.AddComponent<HorizontalLayoutGroup>();
            hl.padding = new RectOffset(16, 16, 7, 7);
            hl.childControlWidth = hl.childControlHeight = true;
            hl.childForceExpandWidth = hl.childForceExpandHeight = false;
            var t = Txt(b, text, 15, c, bold: true, spacing: 3);
            t.textWrappingMode = TextWrappingModes.NoWrap;
        }

        RectTransform PillButton(Transform parent, string label, Action onClick, bool inScroll, float size)
        {
            var b = NewRect("Button", parent);
            var bg = AddImage(b, pill, ButtonBg);
            var hl = b.gameObject.AddComponent<HorizontalLayoutGroup>();
            hl.padding = new RectOffset(16, 16, 6, 6);
            hl.childAlignment = TextAnchor.MiddleCenter;
            hl.childControlWidth = hl.childControlHeight = true;
            hl.childForceExpandWidth = hl.childForceExpandHeight = false;
            b.gameObject.AddComponent<LayoutElement>().minHeight = 40;
            var t = Txt(b, label, size, Body, bold: true);
            t.textWrappingMode = TextWrappingModes.NoWrap;
            t.alignment = TextAlignmentOptions.Center;
            buttons.Add(new Btn { rt = b, onClick = onClick, bg = bg, normal = ButtonBg, hover = ButtonHover, inScroll = inScroll });
            return b;
        }

        internal static Sprite RoundedSprite(int size, int radius)
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

        /// White play triangle or pause bars, drawn into a small texture.
        static Sprite IconSprite(bool play)
        {
            const int n = 48;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp };
            var px = new Color32[n * n];
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    float u = (x + 0.5f) / n, v = (y + 0.5f) / n;
                    bool on = play
                        ? u > 0.22f && u < 0.86f && Mathf.Abs(v - 0.5f) < (0.86f - u) * 0.62f
                        : (u > 0.22f && u < 0.42f || u > 0.58f && u < 0.78f) && v > 0.16f && v < 0.84f;
                    px[y * n + x] = on ? new Color32(255, 255, 255, 255) : new Color32(255, 255, 255, 0);
                }
            }
            tex.SetPixels32(px);
            tex.Apply();
            return Sprite.Create(tex, new Rect(0, 0, n, n), new Vector2(0.5f, 0.5f), 100f);
        }

        static TMP_FontAsset displayFont;

        /// Oswald (Resources/Fonts), the web app's display face, as a dynamic TextMeshPro font.
        static TMP_FontAsset DisplayFont(TMP_FontAsset fallback)
        {
            if (displayFont != null) return displayFont;
            var f = Resources.Load<Font>("Fonts/Oswald-SemiBold");
            if (f != null)
            {
                try { displayFont = TMP_FontAsset.CreateFontAsset(f); }
                catch (Exception e) { Debug.LogWarning($"[StoryPanel] Oswald font asset failed: {e.Message}"); }
            }
            return displayFont != null ? displayFont : fallback;
        }

        // ------------------------------------------------------------------ formatting (as frontend/src/lib.ts)

        static string Coords(float lat, float lon) =>
            string.Format(CultureInfo.InvariantCulture, "{0:0.00}°{1}, {2:0.00}°{3}",
                          Mathf.Abs(lat), lat >= 0 ? "N" : "S", Mathf.Abs(lon), lon >= 0 ? "E" : "W");

        static string FormatDate(string iso) =>
            DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d.ToString("d MMM yyyy", CultureInfo.InvariantCulture) : iso;

        static string FormatShort(string iso) =>
            DateTime.TryParse(iso, CultureInfo.InvariantCulture, DateTimeStyles.None, out var d) ? d.ToString("d MMM", CultureInfo.InvariantCulture) : iso;
    }
}
