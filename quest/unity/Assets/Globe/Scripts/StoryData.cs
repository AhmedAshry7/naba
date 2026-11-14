using System;
using System.Collections.Generic;
using UnityEngine;

namespace Nisar.Globe
{
    /// One NABA story (fire, wetland/flood, earthquake, ground movement...), exported from the web app's data by
    /// pipeline/make_story_data.py into Resources/Stories/stories.json.
    [Serializable]
    public class StoryData
    {
        public string id, headline, region, subtitle;
        public float lat, lon;
        public string changeClass, changeClassLabel, changeType, category, kindLabel;
        /// Theme as in the web app: earthquake, flood (water rising), water (shrinking) or fire.
        public string theme, themeLabel, themeColor;
        /// The web panel's text: plain-language paragraphs and the one-line metric (frontend/src/lib.ts).
        public string[] paragraphs;
        public string metricLine, observedLabel, areaLabel;
        /// Box of the story zone from changes.geojson: minLon, minLat, maxLon, maxLat.
        public float[] bbox;
        public string metricLabel;
        public float metricValue;
        public string metricUnit, metricDirection;
        public string periodStart, periodEnd, periodLabel;
        public int passes;
        public float areaKm2;
        public string confidence, confidenceNote;
        public string summary;
        public string[] causes;
        public string whyItMatters, nextStep, explanation;
        public bool aiGenerated;
        public string eventDate, published;
        public bool isSample;
        public SeriesPoint[] series;
        public string seriesLabel;
        public Measurement[] measurements;
        public StoryLayer[] layers;
        public string[] dataSource;
        /// Detailed local map of the story area (OpenStreetMap via CARTO, in the web map's colours).
        public StoryImage basemap;
        /// The measured areas drawn like the web map (zones + per-month / per-pass areas).
        public StoryHighlights highlights;

        /// The story's theme colour (pins, badge, map highlights).
        public Color ThemeColor =>
            !string.IsNullOrEmpty(themeColor) && ColorUtility.TryParseHtmlString(themeColor, out var c) ? c : StoryDatabase.ClassColor(changeClass);


        public bool HasLayers => layers != null && layers.Length > 0;
        public bool HasSeries => series != null && series.Length > 1;

        /// Geographic box to frame on the map: the story zone's box from changes.geojson, or a box sized from the area.
        public void GetBounds(out float minLat, out float minLon, out float maxLat, out float maxLon)
        {
            if (bbox != null && bbox.Length == 4)
            {
                minLon = bbox[0]; minLat = bbox[1]; maxLon = bbox[2]; maxLat = bbox[3];
                return;
            }
            if (HasLayers && layers[0].bounds != null && layers[0].bounds.Length >= 8)
            {
                minLat = minLon = float.MaxValue;
                maxLat = maxLon = float.MinValue;
                var b = layers[0].bounds;
                for (int i = 0; i + 1 < b.Length; i += 2)
                {
                    minLon = Mathf.Min(minLon, b[i]); maxLon = Mathf.Max(maxLon, b[i]);
                    minLat = Mathf.Min(minLat, b[i + 1]); maxLat = Mathf.Max(maxLat, b[i + 1]);
                }
                return;
            }
            float km = Mathf.Max(30f, Mathf.Sqrt(Mathf.Max(areaKm2, 1f)) * 3f);
            float dLat = km / 111f * 0.5f;
            float dLon = dLat / Mathf.Max(0.2f, Mathf.Cos(lat * Mathf.Deg2Rad));
            minLat = lat - dLat; maxLat = lat + dLat;
            minLon = lon - dLon; maxLon = lon + dLon;
        }
    }

    [Serializable] public class SeriesPoint { public string date; public float value; }
    [Serializable] public class Measurement { public string label, value; }

    [Serializable]
    public class StoryLayer
    {
        public string label, shortLabel;
        /// Corners TL, TR, BR, BL as lon, lat pairs.
        public float[] bounds;
        public StoryFrame[] frames;
    }

    [Serializable] public class StoryFrame
    {
        public string date, label, resource;
        /// The measured value at this step, e.g. "2.42% of area flooded vegetation".
        public string detail;
        /// False when the event is not happening at this step (the map shows the zone in grey).
        public bool active = true;
    }

    [Serializable]
    public class StoryHighlights
    {
        /// Corners TL, TR, BR, BL as lon, lat pairs (same box as the basemap).
        public float[] bounds;
        /// Zones only (no measured areas).
        public string zone;
        /// Time steps of the panel's slider: month, pass (fire) or quake (before / after).
        public StoryFrame[] frames;
        public string kind, title;
        public int defaultIndex;
    }

    [Serializable]
    public class StoryImage
    {
        public string resource;
        /// Corners TL, TR, BR, BL as lon, lat pairs.
        public float[] bounds;
    }

    public static class StoryDatabase
    {
        [Serializable] class StoryFile { public StoryData[] stories; }

        static List<StoryData> cache;

        public static List<StoryData> All
        {
            get
            {
                if (cache != null) return cache;
                cache = new List<StoryData>();
                var json = Resources.Load<TextAsset>("Stories/stories");
                if (json == null)
                {
                    Debug.LogWarning("[Stories] Resources/Stories/stories.json not found (run pipeline/make_story_data.py).");
                    return cache;
                }
                var file = JsonUtility.FromJson<StoryFile>(json.text);
                if (file?.stories != null) cache.AddRange(file.stories);
                return cache;
            }
        }

        /// The web app's theme legend (frontend/src/lib.ts THEME_META).
        public static readonly (string label, Color color)[] ThemeLegend =
        {
            ("Earthquake", new Color(0.239f, 0.839f, 0.549f)),
            ("Flooding (water rising)", new Color(0f, 0.808f, 0.820f)),
            ("Water shrinking", new Color(0.290f, 0.659f, 1f)),
            ("Forest fire", new Color(0.941f, 0.282f, 0.302f)),
        };

        /// Severity colours (kept for stories without a theme colour).
        public static Color ClassColor(string changeClass) => changeClass switch
        {
            "significant" => new Color(0.94f, 0.31f, 0.31f),
            "moderate" => new Color(0.95f, 0.70f, 0.24f),
            "stable" => new Color(0.18f, 0.75f, 0.44f),
            "water" => new Color(0.24f, 0.55f, 1f),
            _ => new Color(0.8f, 0.8f, 0.85f),
        };
    }
}
