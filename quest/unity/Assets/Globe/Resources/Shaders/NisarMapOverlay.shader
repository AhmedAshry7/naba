// A radar image (burn mask, wetland classes, interferogram...) laid on the flat map, clipped to the map window.
Shader "Nisar/MapOverlay"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Alpha ("Opacity", Range(0, 1)) = 1
        [HideInInspector] _MapWindow ("Map Window (halfW, halfH)", Vector) = (0.4, 0.26, 0, 0)
    }
    SubShader
    {
        Tags { "RenderType" = "Transparent" "Queue" = "Transparent-500" "RenderPipeline" = "UniversalPipeline" }
        Pass
        {
            Name "MapOverlay"
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
                float _Alpha;
                float4 _MapWindow;
            CBUFFER_END
            float4x4 _WorldToRoot; // globe root's world-to-local matrix, set from script

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
                float2 rootXY : TEXCOORD1;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);
                float3 ws = TransformObjectToWorld(v.positionOS.xyz);
                o.positionCS = TransformWorldToHClip(ws);
                o.rootXY = mul(_WorldToRoot, float4(ws, 1)).xy;
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);
                clip(_MapWindow.x - abs(i.rootXY.x));
                clip(_MapWindow.y - abs(i.rootXY.y));
                half4 c = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv);
                c.a *= _Alpha;
                return c;
            }
            ENDHLSL
        }
    }
}
