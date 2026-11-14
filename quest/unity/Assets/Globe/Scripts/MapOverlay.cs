using UnityEngine;

namespace Nisar.Globe
{
    /// Draws a geo-referenced image (the story's radar frame, or its detailed basemap) on the flat map at its real bounds.
    /// The quad's corners follow GlobeView.SurfaceLocal, so it stays glued to the map while panning and zooming.
    public class MapOverlay : MonoBehaviour
    {
        GlobeView globe;
        Mesh mesh;
        Material mat;
        MeshRenderer mr;
        float[] bounds; // TL, TR, BR, BL as lon, lat pairs
        float targetAlpha = 1f;
        readonly Vector3[] verts = new Vector3[4];

        static readonly int AlphaId = Shader.PropertyToID("_Alpha");
        static readonly int WindowId = Shader.PropertyToID("_MapWindow");
        static readonly int WorldToRootId = Shader.PropertyToID("_WorldToRoot");

        public void Init(GlobeView g, int renderQueue = 2500)
        {
            globe = g;
            mesh = new Mesh { name = "MapOverlay" };
            mesh.vertices = verts;
            mesh.uv = new[] { new Vector2(0, 1), new Vector2(1, 1), new Vector2(1, 0), new Vector2(0, 0) };
            mesh.triangles = new[] { 0, 1, 2, 0, 2, 3 };
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 1000f);
            mat = GlobeView.CreateMaterial("Nisar/MapOverlay");
            if (mat != null) mat.renderQueue = renderQueue;
            var go = GlobeView.CreateMeshObject("RadarOverlay", g.Spin, mesh, mat);
            mr = go.GetComponent<MeshRenderer>();
            mr.enabled = false;
        }

        /// Shows `frame` of `layer`, or hides the overlay when either is null.
        public void Show(StoryLayer layer, StoryFrame frame)
        {
            bounds = layer?.bounds;
            var tex = frame != null ? Resources.Load<Texture2D>(frame.resource) : null;
            if (bounds == null || bounds.Length < 8 || tex == null)
            {
                Hide();
                return;
            }
            mat.mainTexture = tex;
            // opaque false-colour images are drawn slightly see-through so the map stays readable
            targetAlpha = tex.format == TextureFormat.RGB24 || layer.shortLabel == "False colour" ? 0.85f : 1f;
        }

        /// Shows any image at the given corners (TL, TR, BR, BL as lon, lat pairs).
        public void ShowImage(float[] corners, Texture2D tex, float alpha = 1f)
        {
            if (corners == null || corners.Length < 8 || tex == null || mat == null)
            {
                Hide();
                return;
            }
            bounds = corners;
            mat.mainTexture = tex;
            targetAlpha = alpha;
        }

        public void Hide() => bounds = null;

        void LateUpdate()
        {
            if (globe == null) return;
            bool on = bounds != null && globe.Flatten > 0.6f;
            mr.enabled = on;
            if (!on) return;

            for (int i = 0; i < 4; i++)
                verts[i] = globe.SurfaceLocal(bounds[i * 2 + 1], bounds[i * 2], 0.001f);
            mesh.vertices = verts;

            mat.SetFloat(AlphaId, targetAlpha * Mathf.InverseLerp(0.6f, 1f, globe.Flatten));
            mat.SetVector(WindowId, new Vector4(globe.mapSize.x * 0.5f, globe.mapSize.y * 0.5f, 0f, 0f));
            mat.SetMatrix(WorldToRootId, globe.transform.worldToLocalMatrix); // same units as GlobeView.mapSize
        }
    }
}
