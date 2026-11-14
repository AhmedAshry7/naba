using UnityEngine;
using XRDevices = UnityEngine.XR.InputDevices;
using XRNode = UnityEngine.XR.XRNode;
using XRUsages = UnityEngine.XR.CommonUsages;

namespace Nisar.Globe
{
    /// Navy starfield around the viewer. Follows the camera so the stars always look infinitely far away.
    /// B button (or the B key in the Editor) toggles between space and passthrough.
    public class SpaceBackground : MonoBehaviour
    {
        public Color topColor = new Color(0.035f, 0.05f, 0.1f);
        public Color bottomColor = new Color(0.02f, 0.03f, 0.07f);
        public Color milkyWayColor = new Color(0.25f, 0.3f, 0.55f);
        [Range(0f, 1f)] public float milkyWayStrength = 0f;
        [Range(10f, 200f)] public float starDensity = 60f;
        [Range(0f, 1f)] public float starCoverage = 0.35f;
        [Range(0f, 3f)] public float starBrightness = 1f;
        [Range(0f, 1f)] public float twinkle = 0.25f;
        public Color goldStarColor = new Color(0.91f, 0.71f, 0.29f);
        [Range(0f, 1f)] public float goldStarFraction = 0.2f;
        public float distance = 40f;
        public bool startVisible = true;

        Transform sky;
        Renderer skyRenderer;
        Material mat;
        bool wasToggle;

        void Awake()
        {
            mat = GlobeView.CreateMaterial("Nisar/Starfield");
            var go = GlobeView.CreateMeshObject("Starfield", transform, GeoMath.BuildSphere(48, 24, 1f), mat);
            sky = go.transform;
            sky.localScale = Vector3.one * distance;
            skyRenderer = go.GetComponent<Renderer>();
            skyRenderer.enabled = startVisible;
            Apply();
        }

        void OnValidate()
        {
            if (mat != null) Apply();
            if (sky != null) sky.localScale = Vector3.one * distance;
        }

        void Apply()
        {
            if (mat == null) return;
            mat.SetColor("_TopColor", topColor);
            mat.SetColor("_BottomColor", bottomColor);
            mat.SetColor("_BandColor", milkyWayColor);
            mat.SetFloat("_BandStrength", milkyWayStrength);
            mat.SetFloat("_Density", starDensity);
            mat.SetFloat("_Coverage", starCoverage);
            mat.SetFloat("_Brightness", starBrightness);
            mat.SetFloat("_Twinkle", twinkle);
            mat.SetColor("_GoldColor", goldStarColor);
            mat.SetFloat("_GoldFraction", goldStarFraction);
        }

        public bool Visible
        {
            get => skyRenderer.enabled;
            set => skyRenderer.enabled = value;
        }

        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam != null)
            {
                sky.position = cam.transform.position;
                sky.rotation = Quaternion.identity;
            }

            bool toggle = false;
            var right = XRDevices.GetDeviceAtXRNode(XRNode.RightHand);
            if (right.isValid) right.TryGetFeatureValue(XRUsages.secondaryButton, out toggle);
            var kb = UnityEngine.InputSystem.Keyboard.current;
            if (kb != null && kb.bKey.isPressed) toggle = true;
            if (toggle && !wasToggle) Visible = !Visible;
            wasToggle = toggle;
        }
    }
}
