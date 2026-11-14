using System.Collections;
using System.Collections.Generic;
using UnityEngine;
using XRDevices = UnityEngine.XR.InputDevices;
using XRNode = UnityEngine.XR.XRNode;
using XRUsages = UnityEngine.XR.CommonUsages;

namespace Nisar.Globe
{
    /// Title screen shown when the app opens: the NABA logo sweeps in left to right, the satellite flies in,
    /// tumbles and settles on the last letter (with a signal ping), then the tagline, subtitle and
    /// "Let's start" button fade in. Pointing at the button and pulling the right trigger
    /// (or clicking it in the Editor) fades the intro out and brings in the globe.
    /// Images come from Resources/Intro (made by pipeline/make_intro_assets.py).
    public class IntroScreen : MonoBehaviour
    {
        [Tooltip("Hidden until the button is pressed (the NisarGlobe object).")]
        public GameObject globe;
        [Tooltip("Ray origin. Auto-finds RightControllerAnchor / RightHandAnchor if empty.")]
        public Transform pointer;
        public float distance = 1.6f;
        public float logoWidth = 0.95f;
        [Range(0f, 1f)] public float glowStrength = 0.8f;
        public Color rayColor = new Color(1f, 1f, 1f, 0.55f);
        public Color rayHoverColor = new Color(1f, 0.82f, 0.4f, 0.95f);

        class Element
        {
            public Transform t;
            public Material m;
            public Vector3 basePos;
            public Vector3 baseScale;
        }

        static readonly int ColorId = Shader.PropertyToID("_Color");
        static readonly int RevealId = Shader.PropertyToID("_Reveal");
        static readonly int EdgeId = Shader.PropertyToID("_EdgeStrength");
        const float Softness = 0.08f;

        Element glow, logo, sat, satGlow, tagline, subtitle, button;
        Transform ping;
        Material pingMat;
        float satH;

        [System.Serializable] class Layout { public float satCenterX, satCenterY, satWidth; }
        readonly List<Material> rings = new List<Material>();
        readonly List<Element> all = new List<Element>();
        LineRenderer line;
        Material lineMat;
        bool ready, leaving, hovering, wasPressed;
        float buttonHover;

        void Awake()
        {
            if (globe != null) globe.SetActive(false);
        }

        IEnumerator Start()
        {
            if (pointer == null)
            {
                var a = GameObject.Find("RightControllerAnchor") ?? GameObject.Find("RightHandAnchor");
                if (a != null) pointer = a.transform;
            }
            Build();

            // On the Quest the head pose is still at the floor for the first frames; wait until tracking kicks in.
            float waitUntil = Time.realtimeSinceStartup + 2f;
            while (!HeadTracked() && Time.realtimeSinceStartup < waitUntil) yield return null;
            yield return null;

            PlaceInFrontOfViewer();
            StartCoroutine(PlayIntro());
        }

        static bool HeadTracked()
        {
            var head = XRDevices.GetDeviceAtXRNode(XRNode.CenterEye);
            if (!head.isValid) return true; // no headset (Editor): nothing to wait for
            return head.TryGetFeatureValue(XRUsages.isTracked, out bool tracked) && tracked
                && Camera.main != null && Camera.main.transform.localPosition.sqrMagnitude > 0.01f;
        }

        void LateUpdate()
        {
            // Keep the intro at eye height (smoothly), e.g. if the user sits down or stands up.
            var cam = Camera.main;
            if (cam == null || leaving) return;
            Vector3 p = transform.position;
            p.y = Mathf.Lerp(p.y, cam.transform.position.y, 1f - Mathf.Exp(-3f * Time.deltaTime));
            transform.position = p;
        }

        void PlaceInFrontOfViewer()
        {
            var cam = Camera.main;
            if (cam == null) return;
            Vector3 fwd = cam.transform.forward;
            fwd.y = 0f;
            fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
            transform.position = cam.transform.position + fwd * distance;
            transform.rotation = Quaternion.LookRotation(fwd, Vector3.up);
        }

        void Build()
        {
            var quad = GeoMath.BuildQuad();
            float logoH;
            glow = CreateImage("Glow", "Intro/logo_glow", quad, logoWidth, new Vector2(0f, 0.22f), 3000, out logoH);
            logo = CreateImage("Logo", "Intro/logo", quad, logoWidth, new Vector2(0f, 0.22f), 3001, out _);

            // The satellite's home on the last letter, from Resources/Intro/layout.json.
            var layoutJson = Resources.Load<TextAsset>("Intro/layout");
            var lay = layoutJson != null ? JsonUtility.FromJson<Layout>(layoutJson.text)
                                         : new Layout { satCenterX = 0.84f, satCenterY = 0.38f, satWidth = 0.21f };
            Vector2 home = new Vector2((lay.satCenterX - 0.5f) * logoWidth, 0.22f + (0.5f - lay.satCenterY) * logoH);
            float satW = lay.satWidth * logoWidth;
            satGlow = CreateImage("SatelliteGlow", "Intro/satellite_glow", quad, satW, home, 3002, out _);
            sat = CreateImage("Satellite", "Intro/satellite", quad, satW, home, 3003, out satH);
            sat.basePos.z = satGlow.basePos.z = -0.002f;

            pingMat = GlobeView.CreateMaterial("Nisar/UnlitColor");
            if (pingMat != null) pingMat.renderQueue = 3004;
            ping = GlobeView.CreateMeshObject("Ping", transform, GeoMath.BuildRing(0.05f), pingMat).transform;
            ping.localPosition = new Vector3(home.x, home.y, -0.003f);
            ping.gameObject.SetActive(false);
            tagline = CreateImage("Tagline", "Intro/tagline", quad, 0.62f, new Vector2(0f, -0.05f), 3005, out _);
            subtitle = CreateImage("Subtitle", "Intro/subtitle", quad, 0.5f, new Vector2(0f, -0.14f), 3005, out _);
            button = CreateImage("Button", "Intro/button", quad, 0.2f, new Vector2(0f, -0.26f), 3006, out _);

            var ringMesh1 = GeoMath.BuildRing(0.006f);
            foreach (float r in new[] { 0.3f, 0.5f, 0.68f })
            {
                var m = GlobeView.CreateMaterial("Nisar/UnlitColor");
                if (m == null) continue;
                m.renderQueue = 2999;
                rings.Add(m);
                var go = GlobeView.CreateMeshObject("Ring", transform, ringMesh1, m);
                go.transform.localPosition = new Vector3(0f, -0.02f, 0.03f);
                go.transform.localScale = Vector3.one * r;
            }

            line = new GameObject("IntroPointerRay").AddComponent<LineRenderer>();
            line.useWorldSpace = true;
            line.positionCount = 2;
            line.startWidth = 0.003f;
            line.endWidth = 0.001f;
            line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            lineMat = GlobeView.CreateMaterial("Nisar/UnlitColor");
            line.sharedMaterial = lineMat;
            line.enabled = false;

            foreach (var e in all) SetAlpha(e, 0f);
            foreach (var m in rings) m.SetColor(ColorId, new Color(0.6f, 0.7f, 1f, 0f));
            logo.m.SetFloat(RevealId, -Softness);
            glow.m.SetFloat(RevealId, -Softness);
        }

        Element CreateImage(string name, string resource, Mesh quad, float width, Vector2 pos, int queue, out float height)
        {
            var tex = Resources.Load<Texture2D>(resource);
            var m = GlobeView.CreateMaterial("Nisar/IntroImage");
            height = tex != null ? width * tex.height / tex.width : width * 0.25f;
            if (tex == null) Debug.LogError($"[Intro] Missing Resources/{resource}.png (run pipeline/make_intro_assets.py).");
            if (m != null)
            {
                m.SetTexture("_MainTex", tex);
                m.SetFloat("_Softness", Softness);
                m.renderQueue = queue;
            }
            var go = GlobeView.CreateMeshObject(name, transform, quad, m);
            var e = new Element
            {
                t = go.transform,
                m = m,
                basePos = new Vector3(pos.x, pos.y, 0f),
                baseScale = new Vector3(width, height, 1f),
            };
            e.t.localPosition = e.basePos;
            e.t.localScale = e.baseScale;
            all.Add(e);
            return e;
        }

        static void SetAlpha(Element e, float a)
        {
            if (e.m != null) e.m.SetColor(ColorId, new Color(1f, 1f, 1f, a));
        }

        static float Ease(float t)
        {
            t = Mathf.Clamp01(t);
            return 1f - Mathf.Pow(1f - t, 3f);
        }

        static float EaseInOut(float t)
        {
            t = Mathf.Clamp01(t);
            return t * t * (3f - 2f * t);
        }

        IEnumerator PlayIntro()
        {
            float t0 = Time.time;
            while (true)
            {
                float t = Time.time - t0;

                float ringA = 0.07f * Ease(t / 0.8f);
                foreach (var m in rings) m.SetColor(ColorId, new Color(0.6f, 0.7f, 1f, ringA));

                // Logo sweeps in from left to right with a bright leading edge.
                float r = EaseInOut((t - 0.3f) / 1.6f);
                float reveal = Mathf.Lerp(-Softness, 1f + Softness, r);
                SetAlpha(logo, t > 0.3f ? 1f : 0f);
                logo.m.SetFloat(RevealId, reveal);
                logo.m.SetFloat(EdgeId, Mathf.Sin(r * Mathf.PI) * 1.6f);
                glow.m.SetFloat(RevealId, reveal);
                SetAlpha(glow, glowStrength * Ease((t - 0.6f) / 1.6f));

                // Satellite flies in (1.6 s - 3.4 s) and settles on the last letter, then a signal ping.
                SatelliteFlight((t - 1.6f) / 1.8f);
                float p = (t - 3.3f) / 1.2f;
                ping.gameObject.SetActive(p > 0f && p < 1f);
                if (p > 0f && p < 1f && pingMat != null)
                {
                    float e = Ease(p);
                    ping.localScale = Vector3.one * sat.baseScale.x * Mathf.Lerp(0.15f, 1.4f, e);
                    pingMat.SetColor(ColorId, new Color(0.55f, 0.8f, 1f, 0.9f * (1f - e)));
                }

                FadeUp(tagline, Ease((t - 2.6f) / 0.6f));
                FadeUp(subtitle, Ease((t - 2.9f) / 0.6f));

                float b = Ease((t - 3.4f) / 0.5f);
                SetAlpha(button, b);
                button.t.localScale = button.baseScale * Mathf.Lerp(0.85f, 1f, b);

                if (t > 4.5f) break;
                yield return null;
            }
            ready = true;
        }

        // Settle keys after the flight: time (0..1 of the settle), y offset (fraction of satellite height), rotation, scale.
        static readonly float[] SettleT = { 0f, 0.3f, 0.6f, 0.82f, 1f };
        static readonly float[] SettleY = { -0.10f, 0.09f, -0.03f, 0.01f, 0f };
        static readonly float[] SettleRot = { -14f, 7f, -3f, 1f, 0f };

        /// k = 0..1 over the whole animation: a tumbling arc in from the upper left (first 70%),
        /// then a small bounce as it locks onto its place on the last letter.
        void SatelliteFlight(float k)
        {
            if (k <= 0f)
            {
                SetAlpha(sat, 0f);
                SetAlpha(satGlow, 0f);
                return;
            }
            k = Mathf.Min(k, 1f);
            Vector3 offset;
            float rot, scale;
            if (k < 0.7f)
            {
                float f = 1f - Mathf.Pow(1f - k / 0.7f, 2f); // ease out
                // quadratic arc: far upper-left -> over the logo -> just under its home
                Vector3 p0 = new Vector3(-logoWidth * 1.1f, 0.55f, 0f);
                Vector3 p1 = new Vector3(-logoWidth * 0.35f, 0.42f, 0f);
                Vector3 p2 = new Vector3(0f, SettleY[0] * satH, 0f);
                offset = (1 - f) * (1 - f) * p0 + 2 * (1 - f) * f * p1 + f * f * p2;
                rot = Mathf.Lerp(220f, SettleRot[0], f);
                scale = Mathf.Lerp(0.45f, 1.05f, f);
            }
            else
            {
                float f = (k - 0.7f) / 0.3f;
                int i = 0;
                while (i < SettleT.Length - 2 && f > SettleT[i + 1]) i++;
                float s = EaseInOut((f - SettleT[i]) / (SettleT[i + 1] - SettleT[i]));
                offset = new Vector3(0f, Mathf.Lerp(SettleY[i], SettleY[i + 1], s) * satH, 0f);
                rot = Mathf.Lerp(SettleRot[i], SettleRot[i + 1], s);
                scale = Mathf.Lerp(1.05f, 1f, f);
            }

            foreach (var e in new[] { sat, satGlow })
            {
                e.t.localPosition = e.basePos + offset;
                e.t.localRotation = Quaternion.Euler(0f, 0f, rot);
                e.t.localScale = e.baseScale * scale;
            }
            float a = Mathf.Clamp01(k / 0.08f);
            SetAlpha(sat, a);
            SetAlpha(satGlow, a * glowStrength);
        }

        static void FadeUp(Element e, float a)
        {
            SetAlpha(e, a);
            e.t.localPosition = e.basePos + Vector3.down * (1f - a) * 0.02f;
        }

        void Update()
        {
            if (leaving) return;

            // gentle float on the logo once it has appeared
            if (ready)
            {
                float bob = Mathf.Sin(Time.time * 1.2f) * 0.004f;
                logo.t.localPosition = logo.basePos + Vector3.up * bob;
                glow.t.localPosition = glow.basePos + Vector3.up * bob;
                sat.t.localPosition = sat.basePos + Vector3.up * bob;
                satGlow.t.localPosition = satGlow.basePos + Vector3.up * bob;
            }

            bool xr = ReadXR(out Ray ray, out bool pressed);
            if (!xr) ReadMouse(out ray, out pressed);

            bool onButton = HitsButton(ray, out Vector3 hitPoint);
            hovering = ready && onButton;
            buttonHover = Mathf.MoveTowards(buttonHover, hovering ? 1f : 0f, Time.deltaTime * 6f);
            if (ready)
            {
                button.t.localScale = button.baseScale * (1f + 0.06f * buttonHover);
                button.m.SetColor(ColorId, new Color(1f + 0.15f * buttonHover, 1f + 0.15f * buttonHover, 1f + 0.15f * buttonHover, 1f));
            }

            line.enabled = xr;
            if (xr)
            {
                Vector3 end = hovering ? hitPoint : ray.origin + ray.direction * distance;
                line.SetPosition(0, ray.origin);
                line.SetPosition(1, end);
                if (lineMat != null) lineMat.SetColor(ColorId, hovering ? rayHoverColor : rayColor);
            }

            if (pressed && !wasPressed && hovering) StartCoroutine(Leave());
            wasPressed = pressed;
        }

        bool HitsButton(Ray ray, out Vector3 hit)
        {
            hit = default;
            if (ray.direction == Vector3.zero) return false;
            var plane = new Plane(-transform.forward, button.t.position);
            if (!plane.Raycast(ray, out float d)) return false;
            hit = ray.GetPoint(d);
            Vector3 local = button.t.InverseTransformPoint(hit);
            return Mathf.Abs(local.x) <= 0.5f && Mathf.Abs(local.y) <= 0.5f;
        }

        bool ReadXR(out Ray ray, out bool pressed)
        {
            ray = default;
            pressed = false;
            var right = XRDevices.GetDeviceAtXRNode(XRNode.RightHand);
            if (!right.isValid) return false;
            right.TryGetFeatureValue(XRUsages.triggerButton, out pressed);
            if (pointer != null)
            {
                ray = new Ray(pointer.position, pointer.forward);
            }
            else
            {
                right.TryGetFeatureValue(XRUsages.devicePosition, out Vector3 pos);
                right.TryGetFeatureValue(XRUsages.deviceRotation, out Quaternion rot);
                var cam = Camera.main;
                Transform space = cam != null ? cam.transform.parent : null;
                ray = space != null
                    ? new Ray(space.TransformPoint(pos), space.rotation * rot * Vector3.forward)
                    : new Ray(pos, rot * Vector3.forward);
            }
            return true;
        }

        void ReadMouse(out Ray ray, out bool pressed)
        {
            ray = default;
            pressed = false;
            var mouse = UnityEngine.InputSystem.Mouse.current;
            var cam = Camera.main;
            if (mouse == null || cam == null) return;
            ray = cam.ScreenPointToRay(mouse.position.ReadValue());
            pressed = mouse.leftButton.isPressed;
        }

        IEnumerator Leave()
        {
            leaving = true;
            line.enabled = false;

            float t0 = Time.time;
            while (Time.time - t0 < 0.5f)
            {
                float a = 1f - (Time.time - t0) / 0.5f;
                foreach (var e in all) SetAlpha(e, e == glow || e == satGlow ? a * glowStrength : a);
                foreach (var m in rings) m.SetColor(ColorId, new Color(0.6f, 0.7f, 1f, 0.07f * a));
                transform.localScale = Vector3.one * Mathf.Lerp(1.04f, 1f, a);
                yield return null;
            }

            if (globe != null)
            {
                globe.SetActive(true);
                var view = globe.GetComponent<GlobeView>();
                if (view != null) view.Recenter(0.8f);
                Vector3 target = globe.transform.localScale;
                t0 = Time.time;
                while (Time.time - t0 < 0.8f)
                {
                    float k = (Time.time - t0) / 0.8f;
                    float back = 1f + 2.2f * Mathf.Pow(k - 1f, 3f) + 1.2f * Mathf.Pow(k - 1f, 2f); // ease-out-back
                    globe.transform.localScale = target * Mathf.Lerp(0.2f, 1f, back);
                    yield return null;
                }
                globe.transform.localScale = target;
            }

            Destroy(line.gameObject);
            gameObject.SetActive(false);
        }
    }
}
