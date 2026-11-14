// Procedural space background: navy gradient, faint Milky Way band and twinkling stars.
// Drawn on the inside of a large sphere that follows the camera (see SpaceBackground.cs).
Shader "Nisar/Starfield"
{
    Properties
    {
        _TopColor ("Top Color", Color) = (0.035, 0.05, 0.1, 1)
        _BottomColor ("Bottom Color", Color) = (0.02, 0.03, 0.07, 1)
        _BandColor ("Milky Way Color", Color) = (0.25, 0.3, 0.55, 1)
        _BandStrength ("Milky Way Strength", Range(0, 1)) = 0
        _Density ("Star Density", Range(10, 200)) = 60
        _Coverage ("Star Coverage", Range(0, 1)) = 0.45
        _Brightness ("Star Brightness", Range(0, 3)) = 1.2
        _Twinkle ("Twinkle", Range(0, 1)) = 0.25
        _GoldColor ("Gold Star Color", Color) = (0.91, 0.71, 0.29, 1)
        _GoldFraction ("Gold Star Fraction", Range(0, 1)) = 0.2
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Background" "RenderPipeline" = "UniversalPipeline" }
        Pass
        {
            Name "Starfield"
            Cull Front
            ZWrite On   // writes depth at the sphere so Unity's skybox pass can't paint over it
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _TopColor;
                float4 _BottomColor;
                float4 _BandColor;
                float _BandStrength;
                float _Density;
                float _Coverage;
                float _Brightness;
                float _Twinkle;
                float4 _GoldColor;
                float _GoldFraction;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 dir : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.dir = v.positionOS.xyz;
                return o;
            }

            float3 hash33(float3 p)
            {
                p = frac(p * float3(0.1031, 0.1030, 0.0973));
                p += dot(p, p.yxz + 33.33);
                return frac((p.xxy + p.yxx) * p.zyx);
            }

            float3 StarLayer(float3 dir, float scale, float seed, float coverage)
            {
                float3 p = dir * scale;
                float3 cell = floor(p);
                float3 h = hash33(cell + seed);
                float3 h2 = hash33(cell + seed + 19.19);
                float present = step(h2.x, coverage); // no early-out: fwidth needs uniform control flow

                float d = length(frac(p) - (0.2 + 0.6 * h));
                float px = max(fwidth(d), 1e-4);
                float size = lerp(0.025, 0.08, h.y * h.y * h.y);
                float r = max(size, px * 1.2);
                float core = (1.0 - smoothstep(r - px, r + px, d)) * (size / r);
                float glow = exp(-d * d / (size * size * 8.0)) * 0.25 * h.y;

                float tw = 1.0 - _Twinkle * 0.5 * (1.0 + sin(_Time.y * (1.0 + h2.y * 3.0) + h2.z * 6.2832));
                float3 tint = h2.y < _GoldFraction ? _GoldColor.rgb * 1.4 : lerp(float3(0.78, 0.86, 1.0), float3(1.0, 1.0, 1.0), h2.z);
                return present * tint * (core + glow) * lerp(0.35, 1.0, h.z) * tw;
            }

            half4 frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float3 dir = normalize(i.dir);

                float3 col = lerp(_BottomColor.rgb, _TopColor.rgb, saturate(dir.y * 0.5 + 0.5));
                float b = dot(dir, normalize(float3(0.35, 0.8, 0.48)));
                float wisps = 0.6 + 0.4 * sin(dir.x * 7.0 + dir.z * 5.0) * sin(dir.y * 9.0 - dir.x * 4.0);
                col += _BandColor.rgb * exp(-b * b * 14.0) * wisps * _BandStrength;

                // finer layers have many more cells, so they get much lower coverage to keep the sky sparse
                float3 stars = StarLayer(dir, _Density, 0.0, _Coverage * 0.6)
                             + StarLayer(dir, _Density * 1.9, 7.31, _Coverage * 0.2) * 0.7
                             + StarLayer(dir, _Density * 3.4, 3.77, _Coverage * 0.07) * 0.45;
                col += stars * _Brightness;
                return half4(col, 1);
            }
            ENDHLSL
        }
    }
}
