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

        public bool HasLayers => layers != null && layers.Length > 0;
        public bool HasSeries => series != null && series.Length > 1;

        /// Geographic box to frame on the map: the radar layer's bounds, or a box sized from the area.
        public void GetBounds(out float minLat, out float minLon, out float maxLat, out float maxLon)
        {
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

    [Serializable] public class StoryFrame { public string date, label, resource; }

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

        /// Legend colours, as on the web map.
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
