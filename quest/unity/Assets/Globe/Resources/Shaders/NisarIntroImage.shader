// Transparent image for the intro screen, with a left-to-right reveal and a glowing sweep edge.
Shader "Nisar/IntroImage"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Tint (alpha = fade)", Color) = (1, 1, 1, 1)
        _Reveal ("Reveal (0 hidden, 1 shown)", Range(-0.2, 1.2)) = 1.2
        _Softness ("Reveal Edge Softness", Range(0.001, 0.5)) = 0.08
        _EdgeColor ("Sweep Edge Color", Color) = (0.55, 0.8, 1, 1)
        _EdgeStrength ("Sweep Edge Strength", Range(0, 3)) = 0
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Transparent" "RenderPipeline" = "UniversalPipeline" }
        Pass
        {
            Name "IntroImage"
            Cull Off
            ZWrite Off
            Blend SrcAlpha OneMinusSrcAlpha, One OneMinusSrcAlpha
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                float4 _Color;
                float _Reveal;
                float _Softness;
                float4 _EdgeColor;
                float _EdgeStrength;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                o.positionCS = TransformObjectToHClip(v.positionOS.xyz);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                float4 tex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv);
                float x = i.uv.x;
                float mask = 1.0 - smoothstep(_Reveal - _Softness, _Reveal, x);
                float edge = saturate(1.0 - abs(x - (_Reveal - _Softness * 0.5)) / _Softness);
                float3 rgb = tex.rgb * _Color.rgb + _EdgeColor.rgb * edge * edge * _EdgeStrength;
                return half4(rgb, tex.a * _Color.a * mask);
            }
            ENDHLSL
        }
    }
}
