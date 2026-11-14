// Atmosphere halo: back faces of a slightly larger shell, brightest at the globe's edge and fading outward.
Shader "Nisar/Atmosphere"
{
    Properties
    {
        _Color ("Color", Color) = (0.35, 0.6, 1, 1)
        _Intensity ("Intensity", Range(0, 2)) = 0.9
        _Edge ("Edge (set by GlobeView)", Range(0.01, 1)) = 0.33
        _Power ("Falloff", Range(0.5, 6)) = 2.2
        _LightDir ("Light Direction (world)", Vector) = (-0.5, 0.6, -0.6, 0)
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Transparent-10" "RenderPipeline" = "UniversalPipeline" }
        Pass
        {
            Name "Atmosphere"
            Cull Front
            ZWrite Off
            Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _Color;
                float _Intensity;
                float _Edge;
                float _Power;
                float4 _LightDir;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float3 normalWS : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                VertexPositionInputs p = GetVertexPositionInputs(v.positionOS.xyz);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(v.normalOS);
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float3 n = normalize(i.normalWS);
                float3 v = GetWorldSpaceNormalizeViewDir(i.positionWS);
                float d = saturate(dot(-n, v));                    // 0 at the shell's outer edge
                float glow = pow(saturate(d / _Edge), _Power);      // 1 at the globe's silhouette
                float3 side = normalize(n - v * dot(n, v) + 1e-5);  // screen-plane direction of this fragment
                float lit = saturate(dot(side, normalize(_LightDir.xyz)) * 0.6 + 0.55);
                return half4(_Color.rgb, saturate(glow * lit * _Intensity));
            }
            ENDHLSL
        }
    }
}
