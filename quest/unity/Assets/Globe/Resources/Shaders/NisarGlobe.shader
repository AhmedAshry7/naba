// Globe surface: unlit texture with soft day-side shading and a blue rim highlight.
// _Flatten morphs the sphere into a flat map window facing the viewer (driven by GlobeView).
Shader "Nisar/Globe"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _RimColor ("Rim Color", Color) = (0.45, 0.7, 1, 1)
        _RimPower ("Rim Power", Range(0.5, 8)) = 3
        _RimStrength ("Rim Strength", Range(0, 3)) = 1.1
        _LightDir ("Light Direction (world)", Vector) = (-0.5, 0.6, -0.6, 0)
        _Shade ("Shade Amount", Range(0, 1)) = 0.35
        _FrameColor ("Map Frame Color", Color) = (0.45, 0.7, 1, 1)
        [HideInInspector] _Flatten ("Flatten", Range(0, 1)) = 0
        [HideInInspector] _MapCenter ("Map Center (lat, relLon, zoom, radius)", Vector) = (0, 0, 1, 0.25)
        [HideInInspector] _MapWindow ("Map Window (halfW, halfH, corner)", Vector) = (0.4, 0.26, 0.03, 0)
    }
    SubShader
    {
        Tags { "RenderType" = "Opaque" "Queue" = "Geometry" "RenderPipeline" = "UniversalPipeline" }
        Pass
        {
            Name "Unlit"
            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_instancing
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            TEXTURE2D(_MainTex); SAMPLER(sampler_MainTex);
            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                float4 _RimColor;
                float _RimPower;
                float _RimStrength;
                float4 _LightDir;
                float _Shade;
                float4 _FrameColor;
                float _Flatten;
                float4 _MapCenter;
                float4 _MapWindow;
            CBUFFER_END
            float4x4 _SpinInv; // set from script each frame (matrices can't be material Properties)

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                float2 geo : TEXCOORD1; // (lat, lon relative to the mesh centre) in degrees
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 positionWS : TEXCOORD2;
                float2 mapXY : TEXCOORD3;
                UNITY_VERTEX_OUTPUT_STEREO
            };

            Varyings vert(Attributes v)
            {
                Varyings o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_INITIALIZE_VERTEX_OUTPUT_STEREO(o);

                // Flat position in the globe root's frame (viewer at -Z), then into this mesh's (Spin) space.
                float r = _MapCenter.w;
                float scale = r * _MapCenter.z;
                float cosLat = cos(radians(_MapCenter.x));
                float2 flat = float2(radians(v.geo.y - _MapCenter.y) * cosLat, radians(v.geo.x - _MapCenter.x)) * scale;
                float3 flatOS = mul((float3x3)_SpinInv, float3(flat, -r));
                float3 flatN = mul((float3x3)_SpinInv, float3(0, 0, -1));

                float3 pos = lerp(v.positionOS.xyz, flatOS, _Flatten);
                float3 nrm = normalize(lerp(v.normalOS, flatN, _Flatten));

                VertexPositionInputs p = GetVertexPositionInputs(pos);
                o.positionCS = p.positionCS;
                o.positionWS = p.positionWS;
                o.normalWS = TransformObjectToWorldNormal(nrm);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.mapXY = flat;
                return o;
            }

            half4 frag(Varyings i) : SV_Target
            {
                UNITY_SETUP_STEREO_EYE_INDEX_POST_VERTEX(i);

                // Rounded-rectangle map window; it starts just big enough for the globe and shrinks to size
                // as the map flattens (anything outside is cut, so the unrolling surface never covers the sky).
                float grow = (1.0 - smoothstep(0.0, 1.0, _Flatten)) * _MapCenter.w * 3.0;
                float2 halfSize = _MapWindow.xy + grow;
                float2 q = abs(i.mapXY) - (halfSize - _MapWindow.z);
                float sd = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - _MapWindow.z;
                if (_Flatten > 0.001) clip(-sd);

                float3 n = normalize(i.normalWS);
                float3 v = GetWorldSpaceNormalizeViewDir(i.positionWS);
                float3 l = normalize(_LightDir.xyz);
                float ndl = dot(n, l);
                float3 tex = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, i.uv).rgb;
                float shade = lerp(lerp(1.0 - _Shade, 1.1, saturate(ndl * 0.5 + 0.5)), 1.0, _Flatten);
                float rim = pow(1.0 - saturate(dot(n, v)), _RimPower) * _RimStrength * saturate(ndl * 0.7 + 0.5) * (1.0 - _Flatten);
                float frame = (1.0 - smoothstep(0.0, 0.006, abs(sd))) * smoothstep(0.85, 1.0, _Flatten);
                return half4(tex * shade + _RimColor.rgb * rim + _FrameColor.rgb * frame, 1);
            }
            ENDHLSL
        }
    }
}
