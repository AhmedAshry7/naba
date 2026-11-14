using TMPro;
using UnityEngine;
using XRDevice = UnityEngine.XR.InputDevice;
using XRDevices = UnityEngine.XR.InputDevices;
using XRNode = UnityEngine.XR.XRNode;
using XRUsages = UnityEngine.XR.CommonUsages;

namespace Nisar.Globe
{
    /// Quest controller interaction (falls back to the mouse when no headset is connected):
    ///   Right trigger  : tap = flatten into a zoomed map around that point (tap again to pick a place,
    ///                    tap outside the map to go back), hold + move = drag the globe / pan the map
    ///   Right grip     : hold + move = drag the globe
    ///   Right stick    : left/right = spin, up/down = zoom      Left stick (up/down) : zoom
    ///   Both grips     : hold and pull hands apart / together = zoom in / out
    ///   Story panel    : point + trigger = press its buttons, trigger-drag or thumbstick up/down = scroll
    ///   A button       : map -> back to the globe; globe -> bring it in front of you (R key in the Editor)
    [RequireComponent(typeof(GlobeView), typeof(GlobeSites))]
    public class GlobeControllerInput : MonoBehaviour
    {
        [Tooltip("Ray origin. Auto-finds RightControllerAnchor / RightHandAnchor from the Meta Camera Rig if empty.")]
        public Transform pointer;
        [Tooltip("Left controller, for two-hand zoom. Auto-finds LeftControllerAnchor / LeftHandAnchor if empty.")]
        public Transform leftHand;
        public float rotateSpeed = 90f;
        public float zoomSpeed = 1.2f;
        [Tooltip("Pointer movement (degrees on the globe) below which a trigger press counts as a tap.")]
        public float tapDegrees = 1.5f;
        public Color rayColor = new Color(1f, 1f, 1f, 0.55f);
        public Color rayHitColor = new Color(0.45f, 0.8f, 1f, 0.9f);
        public TMP_FontAsset font;

        GlobeView globe;
        GlobeSites sites;
        StoryPresenter stories;
        bool panelPressed, rayOnPanel;
        Vector3 panelHit;
        LineRenderer line;
        Material lineMat;
        Transform reticle;
        TextMeshPro info;

        bool wasHeld, wasRecenter, dragging, pressWasSelect;
        bool twoHandZoom;
        float twoHandStartDist, twoHandStartZoom, zoomLabelUntil;
        Vector2 grab;
        Vector3 pressDir;
        float moved;
        static readonly int ColorId = Shader.PropertyToID("_Color");

        void Start()
        {
            globe = GetComponent<GlobeView>();
            sites = GetComponent<GlobeSites>();
            stories = GetComponent<StoryPresenter>();
            if (stories == null) stories = gameObject.AddComponent<StoryPresenter>();
            wasHeld = true; // ignore a trigger/click still held from the intro button
            if (pointer == null) pointer = FindAnchor("RightControllerAnchor") ?? FindAnchor("RightHandAnchor");
            if (leftHand == null) leftHand = FindAnchor("LeftControllerAnchor") ?? FindAnchor("LeftHandAnchor");

            var lineGo = new GameObject("PointerRay");
            line = lineGo.AddComponent<LineRenderer>();
            line.useWorldSpace = true;
            line.positionCount = 2;
            line.startWidth = 0.003f;
            line.endWidth = 0.001f;
            line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            line.receiveShadows = false;
            lineMat = GlobeView.CreateMaterial("Nisar/UnlitColor");
            line.sharedMaterial = lineMat;

            var retMat = GlobeView.CreateMaterial("Nisar/UnlitColor");
            if (retMat != null) { retMat.SetColor(ColorId, rayHitColor); retMat.renderQueue = 3010; }
            reticle = GlobeView.CreateMeshObject("Reticle", null, GeoMath.BuildDisc(), retMat).transform;

            var f = CountryLabels.ResolveFont(font);
            if (f != null)
            {
                info = new GameObject("GlobeInfo").AddComponent<TextMeshPro>();
                info.font = f;
                info.fontSize = 10f;
                info.alignment = TextAlignmentOptions.Bottom;
                info.textWrappingMode = TextWrappingModes.Normal;
                info.rectTransform.sizeDelta = new Vector2(30f, 6f);
                info.color = new Color(0.9f, 0.93f, 1f);
            }
        }

        static Transform FindAnchor(string name)
        {
            var go = GameObject.Find(name);
            return go != null ? go.transform : null;
        }

        static bool LeftGripHeld()
        {
            var left = XRDevices.GetDeviceAtXRNode(XRNode.LeftHand);
            return left.isValid && left.TryGetFeatureValue(XRUsages.gripButton, out bool g) && g;
        }

        Vector3 LeftHandPosition()
        {
            if (leftHand != null) return leftHand.position;
            var left = XRDevices.GetDeviceAtXRNode(XRNode.LeftHand);
            left.TryGetFeatureValue(XRUsages.devicePosition, out Vector3 pos);
            var cam = Camera.main;
            Transform space = cam != null ? cam.transform.parent : null;
            return space != null ? space.TransformPoint(pos) : pos;
        }

        void Update()
        {
            bool xr = ReadXR(out Ray ray, out bool selectHeld, out bool grabHeld, out Vector2 stick, out float zoomAxis, out bool recenter);
            if (!xr) ReadMouse(out ray, out selectHeld, out grabHeld, out stick, out zoomAxis, out recenter);

            float zoomBefore = globe.DisplayZoom;
            bool bothGrips = xr && grabHeld && LeftGripHeld();
            if (bothGrips)
            {
                float dist = Vector3.Distance(ray.origin, LeftHandPosition());
                if (!twoHandZoom)
                {
                    twoHandZoom = true;
                    dragging = false;
                    twoHandStartDist = Mathf.Max(dist, 0.05f);
                    twoHandStartZoom = globe.DisplayZoom;
                }
                globe.SetDisplayZoom(twoHandStartZoom * dist / twoHandStartDist);
            }
            else if (twoHandZoom && !grabHeld)
            {
                twoHandZoom = false; // wait for the right grip to be released before dragging again
            }

            bool held = !twoHandZoom && (selectHeld || grabHeld);

            // The story panel takes the pointer while it is pointed at (or a press on it is still held).
            var panel = stories != null ? stories.Panel : null;
            rayOnPanel = panel != null && !twoHandZoom && !dragging && panel.Raycast(ray, out panelHit);
            if (panel != null) panel.Hover(panelHit, rayOnPanel);
            if (panel != null && (rayOnPanel || panelPressed))
            {
                if (selectHeld && !wasHeld) { panel.Press(panelHit); panelPressed = true; }
                else if (selectHeld && panelPressed) panel.Drag(panelHit);
                else if (!selectHeld && panelPressed) { panel.Release(panelHit); panelPressed = false; }
                float scrollInput = stick.y + zoomAxis * 0.25f;
                if (Mathf.Abs(scrollInput) > 0.15f) panel.ScrollBy(-scrollInput * 900f * Time.deltaTime);
                if (recenter && !wasRecenter) { if (globe.IsMap) globe.ExitMap(); else globe.Recenter(); }
                wasHeld = held;
                wasRecenter = recenter;
                sites.SetHover(null);
                UpdateVisuals(xr, ray, false, default, Vector2.zero);
                return;
            }

            bool onGlobe = globe.Raycast(ray, out Vector3 hit);

            // Tapping outside the flat map rolls it back into the globe.
            if (selectHeld && !wasHeld && !onGlobe && globe.MapReady && !twoHandZoom)
                globe.ExitMap();

            if (held && !wasHeld && onGlobe)
            {
                dragging = true;
                pressWasSelect = selectHeld;
                grab = globe.WorldToLatLon(hit);
                pressDir = (hit - globe.Center).normalized;
                moved = 0f;
            }

            if (dragging)
            {
                if (!held)
                {
                    dragging = false;
                    if (pressWasSelect && moved < tapDegrees)
                    {
                        if (!globe.IsMap) globe.EnterMap(grab.x, grab.y);
                        sites.PickLocation(grab.x, grab.y);
                    }
                }
                else
                {
                    Vector3 p = onGlobe ? hit : globe.ClosestSurfacePoint(ray);
                    moved = Mathf.Max(moved, Vector3.Angle(pressDir, (p - globe.Center).normalized));
                    if (moved >= tapDegrees) globe.DragTo(grab.x, grab.y, p);
                }
            }

            if (Mathf.Abs(stick.x) > 0.15f)
                globe.RotateBy(-stick.x * rotateSpeed * Time.deltaTime, 0f);
            float zoomInput = Mathf.Abs(stick.y) > Mathf.Abs(zoomAxis) ? stick.y : zoomAxis;
            if (Mathf.Abs(zoomInput) > 0.15f)
                globe.ZoomBy(1f + zoomInput * zoomSpeed * Time.deltaTime);
            if (!Mathf.Approximately(zoomBefore, globe.DisplayZoom)) zoomLabelUntil = Time.time + 1f;
            if (recenter && !wasRecenter)
            {
                if (globe.IsMap) globe.ExitMap();
                else globe.Recenter();
            }

            wasHeld = held;
            wasRecenter = recenter;

            Vector2 hoverLL = onGlobe ? globe.WorldToLatLon(hit) : Vector2.zero;
            sites.SetHover(onGlobe && !dragging ? sites.SiteNear(hoverLL.x, hoverLL.y) : null);
            UpdateVisuals(xr, ray, onGlobe, hit, hoverLL);
        }

        bool ReadXR(out Ray ray, out bool select, out bool grip, out Vector2 stick, out float zoom, out bool recenter)
        {
            XRDevice right = XRDevices.GetDeviceAtXRNode(XRNode.RightHand);
            XRDevice left = XRDevices.GetDeviceAtXRNode(XRNode.LeftHand);
            ray = default; select = grip = recenter = false; stick = Vector2.zero; zoom = 0f;
            if (!right.isValid) return false;

            right.TryGetFeatureValue(XRUsages.triggerButton, out select);
            right.TryGetFeatureValue(XRUsages.gripButton, out grip);
            right.TryGetFeatureValue(XRUsages.primary2DAxis, out stick);
            right.TryGetFeatureValue(XRUsages.primaryButton, out recenter);
            if (left.isValid && left.TryGetFeatureValue(XRUsages.primary2DAxis, out Vector2 l)) zoom = l.y;

            if (pointer != null)
            {
                ray = new Ray(pointer.position, pointer.forward);
            }
            else
            {
                // No rig anchor found: build the pose from the device, relative to the camera's tracking space.
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

        void ReadMouse(out Ray ray, out bool select, out bool grip, out Vector2 stick, out float zoom, out bool recenter)
        {
            ray = default; select = grip = recenter = false; stick = Vector2.zero; zoom = 0f;
            var mouse = UnityEngine.InputSystem.Mouse.current;
            var cam = Camera.main;
            if (mouse == null || cam == null) return;
            ray = cam.ScreenPointToRay(mouse.position.ReadValue());
            select = mouse.leftButton.isPressed;
            grip = mouse.rightButton.isPressed;
            float scroll = mouse.scroll.ReadValue().y;
            if (Mathf.Abs(scroll) > 0.01f) zoom = Mathf.Sign(scroll) * 4f;
            var kb = UnityEngine.InputSystem.Keyboard.current;
            if (kb != null)
            {
                stick = new Vector2(
                    (kb.rightArrowKey.isPressed ? 1 : 0) - (kb.leftArrowKey.isPressed ? 1 : 0),
                    (kb.upArrowKey.isPressed ? 1 : 0) - (kb.downArrowKey.isPressed ? 1 : 0));
                recenter = kb.rKey.isPressed;
            }
        }

        void UpdateVisuals(bool xr, Ray ray, bool onGlobe, Vector3 hit, Vector2 hoverLL)
        {
            line.enabled = xr;
            if (xr)
            {
                line.SetPosition(0, ray.origin);
                line.SetPosition(1, rayOnPanel ? panelHit : onGlobe ? hit : ray.origin + ray.direction * 0.8f);
                if (lineMat != null) lineMat.SetColor(ColorId, onGlobe || rayOnPanel ? rayHitColor : rayColor);
            }

            reticle.gameObject.SetActive(onGlobe);
            if (onGlobe)
            {
                Vector3 n = globe.SurfaceNormal(hit);
                reticle.position = hit + n * globe.WorldRadius * 0.004f;
                reticle.rotation = Quaternion.FromToRotation(Vector3.up, n);
                reticle.localScale = Vector3.one * globe.WorldRadius * 0.018f;
            }

            if (info == null) return;
            var cam = Camera.main;
            info.transform.position = globe.ContentTop;
            info.transform.localScale = Vector3.one * 0.012f;
            if (cam != null) info.transform.rotation = Quaternion.LookRotation(info.transform.position - cam.transform.position);

            var shown = sites.Hovered ?? sites.Selected;
            if (Time.time < zoomLabelUntil)
                info.text = $"<size=70%>Zoom {Mathf.RoundToInt(globe.DisplayZoom * 100f)}%</size>";
            else if (shown != null)
            {
                string hex = ColorUtility.ToHtmlStringRGB(shown.Color);
                info.text = $"<b>{shown.name}</b>\n<size=70%><color=#{hex}>{shown.Label}</color>   {GeoMath.Format(shown.lat, shown.lon)}</size>";
            }
            else if (onGlobe)
                info.text = $"<size=70%>{GeoMath.Format(hoverLL.x, hoverLL.y)}</size>";
            else if (globe.MapReady)
                info.text = "<size=60%>Press A or tap outside the map to return to the globe</size>";
            else
                info.text = "";
        }
    }
}
