using UnityEngine;

namespace Nisar.Globe
{
    /// Connects story pins to the side panel and the map overlay:
    /// selecting a story flattens the globe, zooms the map to the story's area, lays the radar image on it
    /// and opens the StoryPanel to the right. Returning to the globe (A) or the panel's X closes it.
    /// Added automatically by GlobeControllerInput, so existing scenes need no changes.
    [RequireComponent(typeof(GlobeView), typeof(GlobeSites))]
    public class StoryPresenter : MonoBehaviour
    {
        public StoryPanel Panel { get; private set; }

        GlobeView globe;
        GlobeSites sites;
        MapOverlay overlay, basemap;
        bool wasMap;

        void Awake()
        {
            globe = GetComponent<GlobeView>();
            sites = GetComponent<GlobeSites>();

            Panel = new GameObject("StoryPanel", typeof(RectTransform)).AddComponent<StoryPanel>();
            Panel.Build();
            Panel.Closed += () => { sites.Select(null); overlay.Hide(); basemap.Hide(); };

            basemap = gameObject.AddComponent<MapOverlay>();
            overlay = gameObject.AddComponent<MapOverlay>();
            Panel.FrameChanged += (layer, frame) => overlay.Show(layer, frame);
        }

        void Start()
        {
            basemap.Init(globe, 2490); // under the radar image
            overlay.Init(globe, 2500);
            sites.onSiteSelected.AddListener(OnSelected);
            sites.onLocationPicked.AddListener((lat, lon) => CloseStory());
        }

        void OnSelected(SiteInfo site)
        {
            if (site?.data == null)
            {
                CloseStory();
                return;
            }
            var s = site.data;
            if (!globe.IsMap) globe.EnterMap(s.lat, s.lon);
            s.GetBounds(out float minLat, out float minLon, out float maxLat, out float maxLon);
            globe.FitMapTo(minLat, minLon, maxLat, maxLon);
            if (!s.HasLayers) overlay.Hide();
            if (s.basemap != null && !string.IsNullOrEmpty(s.basemap.resource))
                basemap.ShowImage(s.basemap.bounds, Resources.Load<Texture2D>(s.basemap.resource));
            else
                basemap.Hide();
            Panel.Show(s); // also reports its first radar frame to the overlay
        }

        void CloseStory()
        {
            Panel.Hide();
            overlay.Hide();
            basemap.Hide();
        }

        void LateUpdate()
        {
            if (wasMap && !globe.IsMap) CloseStory(); // back to the globe
            wasMap = globe.IsMap;
            Panel.SetAnchor(globe.PanelAnchor(StoryPanel.WidthMetres), globe.transform.rotation);
        }

        void OnDestroy()
        {
            if (Panel != null) Destroy(Panel.gameObject);
        }
    }
}
