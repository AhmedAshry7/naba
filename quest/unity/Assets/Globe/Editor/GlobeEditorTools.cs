using UnityEditor;
using UnityEditor.SceneManagement;
using UnityEngine;

namespace Nisar.Globe.EditorTools
{
    /// Keeps the globe texture sharp: 8k, mipmapped, and wrapping across the date line.
    class GlobeTextureImport : AssetPostprocessor
    {
        void OnPreprocessTexture()
        {
            if (assetPath.Contains("Globe/Resources/Intro/"))
            {
                // Intro logo and text: keep crisp and keep the transparency.
                var it = (TextureImporter)assetImporter;
                it.alphaIsTransparency = true;
                it.mipmapEnabled = true;
                it.anisoLevel = 4;
                it.wrapMode = TextureWrapMode.Clamp;
                it.maxTextureSize = 2048;
                it.textureCompression = TextureImporterCompression.Uncompressed;
                return;
            }
            if (assetPath.Contains("Globe/Resources/Stories/"))
            {
                // Radar images for the story panel and map overlay (from pipeline/make_story_data.py).
                var st = (TextureImporter)assetImporter;
                st.alphaIsTransparency = true;
                st.mipmapEnabled = true;
                st.anisoLevel = 4;
                st.wrapMode = TextureWrapMode.Clamp;
                st.maxTextureSize = assetPath.Contains("/basemaps/") || assetPath.Contains("/highlights/") ? 2048 : 1024;
                st.textureCompression = TextureImporterCompression.CompressedHQ;
                return;
            }
            if (!assetPath.EndsWith("Globe/Resources/globe_dark.png")) return;
            var ti = (TextureImporter)assetImporter;
            ti.maxTextureSize = 8192;
            ti.mipmapEnabled = true;
            ti.anisoLevel = 4;
            ti.wrapModeU = TextureWrapMode.Repeat;
            ti.wrapModeV = TextureWrapMode.Clamp;
            ti.alphaSource = TextureImporterAlphaSource.None;
            ti.textureCompression = TextureImporterCompression.CompressedHQ;
        }
    }

    static class GlobeMenu
    {
        [MenuItem("NISAR/Create Globe In Scene")]
        static void CreateGlobe()
        {
            var go = new GameObject("NisarGlobe");
            var cam = Camera.main;
            if (cam != null)
            {
                Vector3 fwd = cam.transform.forward;
                fwd.y = 0f;
                fwd = fwd.sqrMagnitude < 1e-4f ? Vector3.forward : fwd.normalized;
                Vector3 p = cam.transform.position + fwd * 0.8f;
                if (cam.transform.position.y < 0.5f) p.y = 1.1f; // Quest rig at floor level in edit mode
                go.transform.position = p;
            }
            else
            {
                go.transform.position = new Vector3(0f, 1.1f, 0.8f);
            }

            go.AddComponent<GlobeView>();
            go.AddComponent<CountryLabels>();
            go.AddComponent<GlobeSites>();
            go.AddComponent<GlobeControllerInput>();

            Undo.RegisterCreatedObjectUndo(go, "Create NISAR Globe");
            AddSpaceBackground();
            Selection.activeGameObject = go;
            EditorSceneManager.MarkSceneDirty(go.scene);
        }

        [MenuItem("NISAR/Create Intro Screen")]
        static void CreateIntro()
        {
            var existing = Object.FindFirstObjectByType<IntroScreen>(FindObjectsInactive.Include);
            if (existing != null)
            {
                Selection.activeGameObject = existing.gameObject;
                return;
            }
            var go = new GameObject("IntroScreen");
            go.transform.position = new Vector3(0f, 1.4f, 1.6f);
            var intro = go.AddComponent<IntroScreen>();
            var view = Object.FindFirstObjectByType<GlobeView>(FindObjectsInactive.Include);
            if (view != null) intro.globe = view.gameObject;
            else Debug.LogWarning("[Intro] No NisarGlobe in the scene yet. Run NISAR > Create Globe In Scene, then assign it to IntroScreen > Globe.");
            Undo.RegisterCreatedObjectUndo(go, "Create Intro Screen");
            AddSpaceBackground();
            Selection.activeGameObject = go;
            EditorSceneManager.MarkSceneDirty(go.scene);
        }

        [MenuItem("NISAR/Add Space Background")]
        static void AddSpaceBackground()
        {
            if (Object.FindFirstObjectByType<SpaceBackground>() != null) return;
            var go = new GameObject("SpaceBackground");
            go.AddComponent<SpaceBackground>();
            Undo.RegisterCreatedObjectUndo(go, "Add Space Background");
            Selection.activeGameObject = go;
            EditorSceneManager.MarkSceneDirty(go.scene);
        }
    }
}
