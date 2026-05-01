/*
    Lexcube - Interactive 3D Data Cube Visualization
    Copyright (C) 2022 Maximilian Söchting <maximilian.soechting@uni-leipzig.de>

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation; either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.

    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import {
	ClampToEdgeWrapping,
	Data3DTexture,
	DataTexture,
	DataUtils,
	Float16BufferAttribute,
	FloatType,
	HalfFloatType,
	LinearFilter,
	Matrix4,
	NearestFilter,
	RedFormat,
	RedIntegerFormat,
	RGFormat,
	Texture,
	UniformsLib,
	UniformsUtils,
	UnsignedByteType,
	UnsignedIntType,
	Vector2,
	Vector3
} from 'three';
import { FLOAT_NAN_REPLACEMENT_VALUE, NON_EXTREME_QUANTILE_INDEX, FLOAT_NOT_LOADED_REPLACEMENT_VALUE, MAXIMUM_SUPPORTED_LOD, TILES_TEXTURE_NAME, TILE_SIZE_3D, range, QUANTILE_INDEX_AND_NAN_FACTOR_MASK_TEXTURE_NAME } from '../constants';

 const newDummyTextureFloat = (useHalfFloat: boolean) => {
 	const data = useHalfFloat ? new Uint16Array(1) : new Float32Array(1);
 	const texture = new Data3DTexture(data, 1, 1, 1);
 	texture.format = RedFormat; // R32F
 	texture.type = useHalfFloat ? HalfFloatType : FloatType;
 	texture.minFilter = texture.magFilter = NearestFilter;
	texture.wrapR = texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
 	texture.needsUpdate = true;
 	return texture;
 };

 const newDummyTextureUint8 = (): Texture => {
 	const data = new Uint8Array(2);
 	const texture = new Data3DTexture(data, 1, 1, 1);
 	texture.format = RGFormat;
	texture.type = UnsignedByteType;
 	texture.minFilter = texture.magFilter = NearestFilter;
	texture.wrapR = texture.wrapS = texture.wrapT = ClampToEdgeWrapping;
 	texture.needsUpdate = true;
 	return texture;
 };

function getVolumeRenderShader(useHalfFloat: boolean, maxLod: number = MAXIMUM_SUPPORTED_LOD) {
	let uniforms = {
		renderstyle: { value: 0 },
		absoluteThreshold: { value: 0.5 },
		quantileThreshold: { value: NON_EXTREME_QUANTILE_INDEX },
		rangeLowerThreshold: { value: 0.0 },
		rangeUpperThreshold: { value: 1.0 },
		thresholdSign: { value: 1 },
		useQuantileOverAbsoluteThreshold: { value: false },
		colormapLowerBound: { value: 0.0 },
		colormapUpperBound: { value: 1.0 },
		colormapFlipped: { value: false },
		colormap: { value: new Texture() },
		lod: { value: 0 },
		tileOffsetsFromTtvs: { value: Array.from({ length: maxLod + 1 }, () => new Vector3()) },	
		tileSizesFromTtvs: { value: Array.from({ length: maxLod + 1 }, () => new Vector3()) },	
		displaySize: { value: new Vector3() },
		displayOffset: { value: new Vector3() },
		totalSize: { value: new Vector3() },
		minClipBoundary: { value: new Vector3(0.0, 0.0, 0.0) },
		maxClipBoundary: { value: new Vector3(1.0, 1.0, 1.0) },
		lightDepthMap: { value: new DataTexture(new Uint8Array(4), 1, 1) },
		lightMatrix: { value: new Matrix4() },
		lightDepthMapIsRgba: { value: false },
		lightDirection: { value: new Vector3(0.0, 1.0, 0.0) },
		outlineWidthVoxels: { value: 0.03 },
		overflowX: { value: false },
		overflowY: { value: false },
		overflowZ: { value: false },

		cubeScale: { value: new Vector3(1.0, 1.0, 1.0) },
		
		pickingMode: { value: 3 }, // 0: single voxel, 1: ball, 2: features, 3: disabled
		pickedPosition: { value: new Vector3() },
		pickedPositionActive: { value: false },
		pickedPositionFeatureId: { value: 0 },
		
		polygonFeatureMap: { value: new DataTexture(new Uint32Array(4), 1, 1, RedIntegerFormat, UnsignedIntType) },
		polygonFeatureMapBoundsMin: { value: new Vector2() },
		polygonFeatureMapBoundsMax: { value: new Vector2() },
	};

	for (let i = 0; i <= maxLod; i++) {
			(uniforms as any)[`${TILES_TEXTURE_NAME}${i}`] = { value: newDummyTextureFloat(useHalfFloat) };
			// (uniforms as any)[`${QUANTILE_INDEX_AND_NAN_FACTOR_MASK_TEXTURE_NAME}${i}`] = { value: newDummyTextureUint8() };
	}

	const tilesTextureAccessCode = (name: string) => range(0, maxLod).map(lod => `${lod == 0 ? "" : "else " }if (lod == ${lod}) {
		return texture(${name}${lod}, texcoords.xyz)${name === QUANTILE_INDEX_AND_NAN_FACTOR_MASK_TEXTURE_NAME ? ".rg" : ".r"};
	}`).join("");

	const VolumeRenderShader1 = {
		uniforms: uniforms,
	
		vertexShader: /* glsl */`
	
			varying vec4 v_nearpos;
			varying vec4 v_farpos;
			varying vec3 v_position;
			varying vec2 v_uv;
	
			void main() {
					// Unproject the current vertex into object space at near and far clip planes.
					mat4 mvp = projectionMatrix * modelViewMatrix;
					mat4 invMvp = inverse(mvp);

					vec4 position4 = vec4(position, 1.0);
					vec4 clipPos = mvp * position4;

					// Use the same clip-space x/y for near/far points.
					vec4 nearClip = vec4(clipPos.xy, -clipPos.w, clipPos.w);
					vec4 farClip = vec4(clipPos.xy, clipPos.w, clipPos.w);

					v_nearpos = invMvp * nearClip;
					v_farpos = invMvp * farClip;

					// Set varyings and output pos
					v_position = position;
					v_uv = uv;
					gl_Position = clipPos;
			}`,

		fragmentShader: /*glsl*/`
					precision highp float;
					precision highp sampler3D;
					#include <packing>
					
					uniform vec3 tileSizesFromTtvs[${maxLod + 1}];
					uniform vec3 tileOffsetsFromTtvs[${maxLod + 1}];` +
					`${range(0, maxLod).map(i => `uniform highp sampler3D ${TILES_TEXTURE_NAME}${i};`).join("\n")}` +
					/*
					 `\n${range(0, maxLod).map(i => `uniform highp sampler3D ${QUANTILE_INDEX_AND_NAN_FACTOR_MASK_TEXTURE_NAME}${i};`).join("\n")}` +
					 */

					/*glsl*/`
	
					uniform int renderstyle;
					uniform float absoluteThreshold;
					uniform int quantileThreshold;
					uniform float rangeLowerThreshold;
					uniform float rangeUpperThreshold;
					uniform float thresholdSign;
					uniform float colormapLowerBound;
					uniform float colormapUpperBound;
					uniform bool colormapFlipped;
					uniform bool useQuantileOverAbsoluteThreshold;

					uniform mat4 projectionMatrix; 
					uniform mat4 modelViewMatrix;

					uniform sampler2D colormap;
	
					varying vec3 v_position;
					varying vec4 v_nearpos;
					varying vec4 v_farpos;
					varying vec2 v_uv;
	
					const float TILE_SIZE = ${TILE_SIZE_3D}.0;
					const float NAN_REPLACEMENT_VALUE = ${FLOAT_NAN_REPLACEMENT_VALUE}.0;
					const float NOT_LOADED_REPLACEMENT_VALUE = ${FLOAT_NOT_LOADED_REPLACEMENT_VALUE}.0;
	
					uniform vec3 totalSize;
					uniform vec3 displaySize; // what is being displayed on the cube, subset of the whole thing
					uniform vec3 displayOffset;

					uniform float outlineWidthVoxels;

					uniform vec3 minClipBoundary;
					uniform vec3 maxClipBoundary;

					uniform vec3 cubeScale;
	
					uniform int lod;

					uniform bool overflowX;
					uniform bool overflowY;
					uniform bool overflowZ;
					
					uniform sampler2D lightDepthMap;
					uniform mat4 lightMatrix;
					uniform bool lightDepthMapIsRgba;
					uniform vec3 lightDirection;

					uniform ivec3 pickedPosition;
					uniform bool pickedPositionActive;
					uniform uint pickedPositionFeatureId;
					uniform int pickingMode;

					uniform usampler2D polygonFeatureMap;
					uniform vec2 polygonFeatureMapBoundsMin;
					uniform vec2 polygonFeatureMapBoundsMax;
	
					vec4 cast_iso_dda(vec3 nearpos_data, vec3 enter_point_data, vec3 exit_point_data, vec3 rayDir, vec3 initEnterFaceNormalWorld, vec3 dOdx, vec3 dOdy, vec3 dDdx, vec3 dDdy);

					const int MAX_DDA_STEPS = 4096;

					float sample1(vec3 texcoords);
					// vec2 sample_quantile_index_and_nan_factor_mask(vec3 texcoords);
					// float sample_alpha_from_quantile_index(vec3 texcoords);
					vec4 apply_colormap(float val);
					vec4 add_lighting_with_hitpos(float val, vec3 hit_pos_world, vec3 faceNormalWorld, vec3 outlineFootprint, bool picked);

					#ifdef PICK_PASS
						layout(location = 0) out uvec4 outPick; // RGBA32UI output for pick pass
					#else
						layout(location = 0) out vec4 outColor; // RGBA8 output for color and depth pass
					#endif


					uint getFeatureIdFromPolygonFeatureMap(vec3 world_coords) {
						vec2 boundsMin = polygonFeatureMapBoundsMin; // bounds relating to totalSize
						vec2 boundsMax = polygonFeatureMapBoundsMax;
						vec2 normalizedCoords = ((world_coords.xy / totalSize.xy) - boundsMin) / (boundsMax - boundsMin);
						vec2 texCoords = normalizedCoords;
						if (texCoords.x < 0.0 || texCoords.x > 1.0 || texCoords.y < 0.0 || texCoords.y > 1.0) {
							return 0u; // outside of bounds, treat as background
						}
						// return texelFetch(polygonFeatureMap, ivec2(floor(texCoords * vec2(textureSize(polygonFeatureMap, 0)))), 0).r;
						return texture(polygonFeatureMap, texCoords).r;
					}

					// Returns 0..1 where 1 = on outline (new contour shading, stable at neighbor-less edges)
					float outline2D(vec2 d, vec2 fw2)
					{
						// Shrink outline as pixel footprint grows to reduce moire
						// Use per-axis footprint to avoid gaps for anisotropic footprints
						vec2 fw2Safe = max(fw2, vec2(1e-7));
						float baseWidth = outlineWidthVoxels * 2.0;
						float maxWidth = baseWidth * 0.25;
						float widthX = min(baseWidth / (20.0 * fw2Safe.x), maxWidth);
						float widthY = min(baseWidth / (20.0 * fw2Safe.y), maxWidth);
						float aaX = max(fw2Safe.x, widthX * 1.5);
						float aaY = max(fw2Safe.y, widthY * 1.5);

						float g1 = 1.0 - smoothstep(widthX, widthX + aaX, d.x);
						float g2 = 1.0 - smoothstep(widthY, widthY + aaY, d.y);

						float minFade = 0.0;
						float maxFw = 0.5; // for when we are really zoomed out and seeing lots of voxels -> cap to not have moire at very large displaySizes
						float tx = clamp(1.0 - fw2.x / maxFw, 0.0, 1.0);
						float ty = clamp(1.0 - fw2.y / maxFw, 0.0, 1.0);
						float fadeX = mix(minFade, 1.0, pow(tx, 2.2));
						float fadeY = mix(minFade, 1.0, pow(ty, 2.2));

						return max(g1 * fadeX, g2 * fadeY);
					}

					float outlinePlaneFade(float normalFw)
					{
						// Fade contours orthogonal to very large dimensions (large footprint along normal).
						float minFade = 0.0;
						float maxFw = 0.25;
						float t = clamp(1.0 - normalFw / maxFw, 0.0, 1.0);
						return mix(minFade, 1.0, pow(t, 2.2));
					}

					float voxelContourMask(vec3 hitPosWorld, vec3 faceNormalWorld, vec3 outlineFootprint)
					{
						// outlineFootprint: in volume/cube units, the size of the pixel footprint at the hit position
						// Use local coordinates with a tiny clamp to avoid boundary flicker.
						vec3 local = hitPosWorld - floor(hitPosWorld);
						if (abs(faceNormalWorld.x) > 0.5) {
							local.x = (faceNormalWorld.x > 0.0) ? (1.0 - 1e-7) : 1e-7;
						} else if (abs(faceNormalWorld.y) > 0.5) {
							local.y = (faceNormalWorld.y > 0.0) ? (1.0 - 1e-7) : 1e-7;
						} else if (abs(faceNormalWorld.z) > 0.5) {
							local.z = (faceNormalWorld.z > 0.0) ? (1.0 - 1e-7) : 1e-7;
						}
						local = clamp(local, vec3(1e-7), vec3(1.0 - 1e-7));
						vec3 footprint = max(outlineFootprint, vec3(1e-6));
						vec3 weightScale = max(footprint, vec3(outlineWidthVoxels * 0.5));

						// Distance to nearest boundary per axis.
						vec3 d = min(local, 1.0 - local);

						// Compute per-plane outlines (XY, XZ, YZ) and blend by boundary proximity.
						float outlineX = outline2D(d.yz, footprint.yz) * outlinePlaneFade(footprint.x); // plane normal X - "left" faces in standard view
						float outlineY = outline2D(d.xz, footprint.xz) * outlinePlaneFade(footprint.y); // plane normal Y - "top" faces in standard view
						float outlineZ = outline2D(d.xy, footprint.xy) * outlinePlaneFade(footprint.z); // plane normal Z - "front" faces in standard view

						float wx = 1.0 - smoothstep(0.0, weightScale.x * 2.0 + 1e-5, d.x);
						float wy = 1.0 - smoothstep(0.0, weightScale.y * 2.0 + 1e-5, d.y);
						float wz = 1.0 - smoothstep(0.0, weightScale.z * 2.0 + 1e-5, d.z);

						float wsum = wx + wy + wz + 1e-6;
						float outline = (outlineX * wx + outlineY * wy + outlineZ * wz) / wsum;
						return outline;
					}
	
					vec3 transform_renderworld_to_data(vec3 pos) {
						vec3 p = vec3(-pos.z, -pos.y, pos.x); // fit to our definition of XYZ, analogue to fixing UV attributes
						p /= cubeScale;
						p = p + vec3(0.5);
						return (p * displaySize + displayOffset); 
					}

					vec3 detransform(vec3 pos) {
						vec3 p = (pos - displayOffset) / displaySize;
						p = p - vec3(0.5);
						p = p * cubeScale;
						return vec3(p.z, -p.y, -p.x);
					}

	
					void main() {
							// Normalize clipping plane info
							vec3 farpos = v_farpos.xyz / v_farpos.w;
							vec3 nearpos = v_nearpos.xyz / v_nearpos.w;
	
							// data space, i.e. [[0, 0, 0], [1440, 720, 1978]]
							vec3 nearpos_data = transform_renderworld_to_data(nearpos);
							vec3 farpos_data = transform_renderworld_to_data(farpos);
							// Ray origin is the near plane point (works for both perspective + ortho).
							vec3 ray_origin_data = nearpos_data;

							// Calculate unit vector pointing from near to far (front-to-back).
							vec3 V = farpos_data.xyz - nearpos_data.xyz;
							float invDist = inversesqrt(max(dot(V, V), 1e-12));
							vec3 view_ray = V * invDist;

							// Derivatives computed before any branching (stable)
							vec3 dOdx = dFdx(nearpos_data);
							vec3 dOdy = dFdy(nearpos_data);
							vec3 dVdx = dFdx(V);
							vec3 dVdy = dFdy(V);
							vec3 dDdx = (dVdx - view_ray * dot(view_ray, dVdx)) * invDist;
							vec3 dDdy = (dVdy - view_ray * dot(view_ray, dVdy)) * invDist;
	
							// Data coordinates box of visualized data - this can fill the whole cube or be less
							// Because of enter_point logic below, this can be less than the whole cube (e.g. for multi-block rendering)
							// (small offsets to avoid sampling issues on the boundaries)
							vec3 boxMin = max(displayOffset, tileOffsetsFromTtvs[lod]) + vec3(0.01);
							vec3 boxMax = min(displayOffset + displaySize, tileOffsetsFromTtvs[lod] + tileSizesFromTtvs[lod]) - vec3(0.01);

							// can technically only happen when TTV is outside of displayOffset/Size-covered area
							if (boxMin.x >= boxMax.x || boxMin.y >= boxMax.y || boxMin.z >= boxMax.z) {
								discard;
							}

							// Ray-box intersection (slab method)
							vec3 invDir = 1.0 / view_ray;

							vec3 t0 = (boxMin - ray_origin_data) * invDir;
							vec3 t1 = (boxMax - ray_origin_data) * invDir;

							vec3 tminv = min(t0, t1);
							vec3 tmaxv = max(t0, t1);

							float tEnter = max(max(tminv.x, tminv.y), tminv.z);
							float tExit  = min(min(tmaxv.x, tmaxv.y), tmaxv.z);

							// If box is missed completely, discard
							if (tExit < tEnter) {
								discard;
							}

							// enter point could have changed (e.g. because of minClipBoundary)
							vec3 enter_point_data = ray_origin_data + view_ray * tEnter;
							vec3 exit_point_data = ray_origin_data + view_ray * tExit;

							// Ray direction through the clipped volume (away from the camera)
							vec3 rayDir = normalize(exit_point_data - enter_point_data);

							// Stable initial face normal, uses the ray-box entry plane (slab axis from tEnter).
							// This remains correct even for sub-voxel clip boxes (fractional displayOffset/displaySize),
							// where the ray enters through a clip plane rather than a voxel boundary.
							vec3 initEnterFaceNormalWorld = vec3(0.0);
							if (tminv.x >= tminv.y && tminv.x >= tminv.z) {
								initEnterFaceNormalWorld = vec3(-(view_ray.x >= 0.0 ? 1.0 : -1.0), 0.0, 0.0);
							} else if (tminv.y >= tminv.x && tminv.y >= tminv.z) {
								initEnterFaceNormalWorld = vec3(0.0, -(view_ray.y >= 0.0 ? 1.0 : -1.0), 0.0);
							} else {
								initEnterFaceNormalWorld = vec3(0.0, 0.0, -(view_ray.z >= 0.0 ? 1.0 : -1.0));
							}
							
							#ifdef DEPTH_PASS
								// Shadow/depth pass: raymarch and pack the hit depth.
								vec4 hit = cast_iso_dda(nearpos_data, enter_point_data, exit_point_data, rayDir, initEnterFaceNormalWorld, dOdx, dOdy, dDdx, dDdy);
                                float hitDepth = hit.r;

                                if (hitDepth < 0.0) {
                                    discard;
                                }

                                // hitDepth is already in [0..1] (glDepth). Store & pack deterministically.
                                gl_FragDepth = hitDepth;
                                outColor = packDepthToRGBA(hitDepth);
								return;
							#endif

							#ifdef PICK_PASS
								// Pick pass: raymarch and pack the hit voxel coordinate as uint in RGBA8.
								outPick = uvec4(0u);
								vec4 hit = cast_iso_dda(nearpos_data, enter_point_data, exit_point_data, rayDir, initEnterFaceNormalWorld, dOdx, dOdy, dDdx, dDdy);
								return;
							#endif

							#ifdef COLOR_PASS
								vec4 resultColor = vec4(0.0);

								// if (renderstyle == 0 || renderstyle == 1)
								// 		resultColor = cast_mip(start_loc, step, nsteps, view_ray, sign(-float(renderstyle)+0.5)); // 0 = max, 1 = min projection
								// else if (renderstyle == 2)
								
								resultColor = cast_iso_dda(nearpos_data, enter_point_data, exit_point_data, rayDir, initEnterFaceNormalWorld, dOdx, dOdy, dDdx, dDdy);

								if (resultColor.a < 0.05)
									discard;

								outColor = resultColor;
							#endif
					}

					vec3 tex_coords_from_world_coords(vec3 world_coords) {
						vec3 candidate_world_coords = world_coords;

						float tile_size_adjusted = TILE_SIZE * pow(2.0, float(lod));
						
						float overflowSkipOffset = tile_size_adjusted - mod(totalSize.x, tile_size_adjusted);
						bool overflownTtv = tileOffsetsFromTtvs[lod].x + tileSizesFromTtvs[lod].x - overflowSkipOffset > totalSize.x;
						bool overflownDisplay = displayOffset.x + displaySize.x > totalSize.x;
						
						if (overflowX && candidate_world_coords.x >= totalSize.x && overflownTtv) { 
							candidate_world_coords.x += overflowSkipOffset; // push ahead to skip the "overflow" part of overflow tiles 
						} 

						// CASE 2 - ttv in small-positive domain, display/pixel in overflow domain
						if (overflowX && !overflownTtv && candidate_world_coords.x >= totalSize.x) {
							candidate_world_coords.x += -totalSize.x; // push back into small-positive domain
						}
						
						// CASE 3 - ttv in overflow domain, display/pixel in small-positive domain -> push display into overflow domain, minus the overflow part
						if (overflowX && overflownTtv && !overflownDisplay) {
							candidate_world_coords.x += totalSize.x + overflowSkipOffset; // push ahead to reach the overflow part of overflow tiles
						}
						vec3 texcoords = (candidate_world_coords - tileOffsetsFromTtvs[lod]) / tileSizesFromTtvs[lod];

						return texcoords;
					}
	
	
					float sample1(vec3 world_coords) {
						vec3 texcoords = tex_coords_from_world_coords(world_coords);
						${tilesTextureAccessCode(TILES_TEXTURE_NAME)}
						return 0.0;
					}

					/* 
					vec2 sample_quantile_index_and_nan_factor_mask(vec3 world_coords) {
						vec3 texcoords = tex_coords_from_world_coords(world_coords);
						${tilesTextureAccessCode(QUANTILE_INDEX_AND_NAN_FACTOR_MASK_TEXTURE_NAME)}
						return vec2(${NON_EXTREME_QUANTILE_INDEX});
					}

					float sample_alpha_from_nan_factor_mask(vec3 world_coords) {
						// implicit scale since NAN_FACTOR_MASK_NAN_VALUE = 0/0.0, and NAN_FACTOR_MASK_VALID_VALUE = 255/1.0
						float alpha = sample_quantile_index_and_nan_factor_mask(world_coords).y;
						return alpha;
					}

					// returns 1.0 if quantile index is visible, 0.0 if not 
					// TODO: this function needs to be checked again, after the texture changes etc.
					float sample_alpha_from_quantile_index(vec3 texcoords) {
						float q = sample_quantile_index_and_nan_factor_mask(texcoords).x * 255.0;
						uint qi = uint(round(q));
						if (qi == ${NON_EXTREME_QUANTILE_INDEX}u) {
							return 0.0;
						}
						if (qi < ${NON_EXTREME_QUANTILE_INDEX}u) {
							return qi <= uint(quantileThreshold) ? 1.0 : 0.0;
						} else {
							return qi >= uint(quantileThreshold) ? 1.0 : 0.0;
						}
					}
					*/
	
					
	
					vec4 apply_colormap(float val) {
							val = (val - colormapLowerBound) / (colormapUpperBound - colormapLowerBound);
							if (colormapFlipped) {
								val = 1.0 - val;
							}
							return texture2D(colormap, vec2(val, 0.5));
					}
	
	

                    // === Voxel DDA traversal in world coordinates ===
					vec4 cast_iso_dda(vec3 nearpos_data, vec3 enter_point_data, vec3 exit_point_data, vec3 rayDir, vec3 initEnterFaceNormalWorld, vec3 dOdx, vec3 dOdy, vec3 dDdx, vec3 dDdy) {
                        // Grid size in voxels for the currently bound 3D texture view
						ivec3 gridLowerBound = ivec3(tileOffsetsFromTtvs[lod]);
                        ivec3 gridUpperBound = ivec3(tileSizesFromTtvs[lod] + tileOffsetsFromTtvs[lod] + vec3(0.5));
                        // Defensive: avoid division by zero / empty textures
                        if (gridUpperBound.x <= 0 || gridUpperBound.y <= 0 || gridUpperBound.z <= 0) {
                            #ifdef COLOR_PASS
                            return vec4(0.0);
                            #else
                            return vec4(-1.0);
                            #endif
                        }

                        float s = thresholdSign;
                        float quantileAlphaThreshold = s * 0.5;
                        float threshold = useQuantileOverAbsoluteThreshold ? quantileAlphaThreshold : absoluteThreshold;

                        // Start voxel
						// Nudge the entry point slightly along the ray to avoid landing exactly on voxel boundaries,
						// which can cause face selection to flicker for sub-voxel clip boxes.
						const float START_EPS = 1e-4;
						vec3 p = enter_point_data + rayDir * START_EPS;
						ivec3 v = ivec3(floor(p));

						// Clamp outside values into grid - just for emergency border values that got pushed out due to float error
						// Real adjustment to valid volume happens with enter_point calculation
                        v = max(v, gridLowerBound); 
                        v = min(v, gridUpperBound - ivec3(1));

                        ivec3 stepI = ivec3(
                            (rayDir.x > 0.0) ? 1 : ((rayDir.x < 0.0) ? -1 : 0),
                            (rayDir.y > 0.0) ? 1 : ((rayDir.y < 0.0) ? -1 : 0),
                            (rayDir.z > 0.0) ? 1 : ((rayDir.z < 0.0) ? -1 : 0)
                        );

                        const float INF = 1e20;

                        // t is distance along rayDir since rayDir is normalized
                        float maxT = distance(exit_point_data, enter_point_data);

                        float tMaxX = INF;
                        float tMaxY = INF;
                        float tMaxZ = INF;

                        float tDeltaX = INF;
                        float tDeltaY = INF;
                        float tDeltaZ = INF;

                        if (stepI.x != 0) {
                            float nextBx = (stepI.x > 0) ? float(v.x + 1) : float(v.x);
                            tMaxX = (nextBx - p.x) / rayDir.x;
                            tDeltaX = abs(1.0 / rayDir.x);
                        }
                        if (stepI.y != 0) {
                            float nextBy = (stepI.y > 0) ? float(v.y + 1) : float(v.y);
                            tMaxY = (nextBy - p.y) / rayDir.y;
                            tDeltaY = abs(1.0 / rayDir.y);
                        }
                        if (stepI.z != 0) {
                            float nextBz = (stepI.z > 0) ? float(v.z + 1) : float(v.z);
                            tMaxZ = (nextBz - p.z) / rayDir.z;
                            tDeltaZ = abs(1.0 / rayDir.z);
                        }

                        float t = 0.0;

						// Face normal for the surface we entered through for the *current* voxel.
						// For the first voxel, this is the clip-box entry plane normal computed in main().
						// After the first DDA step, updated based on the voxel boundary we crossed.
						vec3 enterFaceNormalWorld = initEnterFaceNormalWorld;
						

						// For voxel outlines, derivatives are passed in (computed before branching)
						float t_from_nearpos_to_enterpoint = dot(enter_point_data - nearpos_data, rayDir);

						vec4 accumulatedColor = vec4(0.0);


                        for (int iter = 0; iter < MAX_DDA_STEPS; iter++) {
                            if (t > maxT) {
								break;
							}

                            // Sample at voxel center (stable)
							vec3 sample_pos_world = vec3(v) + vec3(0.5);

                            // float alphaMask = sample_alpha_from_nan_factor_mask(sample_pos_world);
                            // float val = useQuantileOverAbsoluteThreshold ? 
							// 	(s * sample_alpha_from_quantile_index(sample_pos_world)) : sample1(sample_pos_world);
							float val = sample1(sample_pos_world);
							bool valIsNan = (val == NAN_REPLACEMENT_VALUE || val == NOT_LOADED_REPLACEMENT_VALUE);

							bool voxel_hit = !valIsNan && ((s != 0.0 && s * val >= s * threshold) || (s == 0.0 && val <= rangeUpperThreshold && val >= rangeLowerThreshold));

							// #ifdef COLOR_PASS
							// if (voxel_hit && pickedPositionActive && v != pickedPosition) {
							// 	alphaMask = 0.0;
							// 	voxel_hit = false;
							// 	accumulatedColor = vec4(0.5);
							// }
							// #endif

							if (voxel_hit) {
                                // Hit position (use entry time t into current voxel)
                                vec3 hit_pos_world = enter_point_data + rayDir * t;
								
								uint featureId = getFeatureIdFromPolygonFeatureMap(vec3(sample_pos_world));

								#ifdef PICK_PASS
									outPick = uvec4(uint(v.x), uint(v.y), uint(v.z), 1u + featureId);
									return vec4(1.0);
								#endif

                                #ifdef DEPTH_PASS
                                    vec3 hitPosLocal = detransform(hit_pos_world);
                                    vec4 mvPosition = modelViewMatrix * vec4(hitPosLocal, 1.0);
                                    vec4 clipPos = projectionMatrix * mvPosition;
                                    float ndcDepth = clipPos.z / clipPos.w;
                                    float glDepth = ndcDepth * 0.5 + 0.5;
                                    return vec4(glDepth, 0.0, 0.0, 1.0);
								#endif

                                #ifdef COLOR_PASS
                                    // If gating by quantile, shade with the real scalar
                                    float shadeVal = val; // useQuantileOverAbsoluteThreshold ? sample1(sample_pos_world) : val;
									float tTotal = t + t_from_nearpos_to_enterpoint;

									// Approximate derivatives of t using the entered face plane
									float dTdx = 0.0;
									float dTdy = 0.0;
									float planeCoord = 0.0;
									float Da = 0.0;
									float dOdx_a = 0.0;
									float dOdy_a = 0.0;
									float dDdx_a = 0.0;
									float dDdy_a = 0.0;

									if (abs(enterFaceNormalWorld.x) > 0.5) {
										planeCoord = float(v.x) + (enterFaceNormalWorld.x > 0.0 ? 1.0 : 0.0);
										Da = rayDir.x;
										dOdx_a = dOdx.x;
										dOdy_a = dOdy.x;
										dDdx_a = dDdx.x;
										dDdy_a = dDdy.x;
									} else if (abs(enterFaceNormalWorld.y) > 0.5) {
										planeCoord = float(v.y) + (enterFaceNormalWorld.y > 0.0 ? 1.0 : 0.0);
										Da = rayDir.y;
										dOdx_a = dOdx.y;
										dOdy_a = dOdy.y;
										dDdx_a = dDdx.y;
										dDdy_a = dDdy.y;
									} else {
										planeCoord = float(v.z) + (enterFaceNormalWorld.z > 0.0 ? 1.0 : 0.0);
										Da = rayDir.z;
										dOdx_a = dOdx.z;
										dOdy_a = dOdy.z;
										dDdx_a = dDdx.z;
										dDdy_a = dDdy.z;
									}

									if (abs(Da) > 1e-6) {
										float tPlane = (planeCoord - nearpos_data.x) / Da;
										if (abs(enterFaceNormalWorld.y) > 0.5) {
											tPlane = (planeCoord - nearpos_data.y) / Da;
										} else if (abs(enterFaceNormalWorld.z) > 0.5) {
											tPlane = (planeCoord - nearpos_data.z) / Da;
										}

										dTdx = -(dOdx_a + tPlane * dDdx_a) / Da;
										dTdy = -(dOdy_a + tPlane * dDdy_a) / Da;
									}

									vec3 dPdx = dOdx + dDdx * tTotal + dTdx * rayDir;
									vec3 dPdy = dOdy + dDdy * tTotal + dTdy * rayDir;
									vec3 outlineFootprint = abs(dPdx) + abs(dPdy); // axis-aligned footprint


									// bool picked = !pickedPositionActive || (pickedPositionActive && v == pickedPosition); // correct
									bool picked = !pickedPositionActive || pickingMode >= 3;

									if (pickedPositionActive && pickingMode < 3) {
										if (pickingMode == 0) {
											picked = (v == pickedPosition); // 0: single voxel picking mode, require exact match
										} else if (pickingMode == 1) {
											picked = (length((vec3(v) - vec3(pickedPosition)) / displaySize) < 0.2); // 1: ball picking mode, pick if within 20% of display size in world coords
										} else if (pickingMode == 2) {
											picked = (pickedPositionFeatureId == 0u || featureId == pickedPositionFeatureId); // 2: polygon picking mode, pick if feature ID matches
										}
									}

									vec4 hit_color = add_lighting_with_hitpos(shadeVal, hit_pos_world, enterFaceNormalWorld, outlineFootprint, picked);
									if (picked) {
										return vec4(accumulatedColor.rgb * accumulatedColor.a + hit_color.rgb * (1.0 - accumulatedColor.a), 1.0); // standard alpha compositing
									}
									if (accumulatedColor.a == 0.0) {
										accumulatedColor = hit_color; // set color only on first hit for better blending with outlines
									}
									//return vec4(enterFaceNormalWorld * 0.5 + 0.5, 1.0); // debug: visualize normal
                                #endif
                            }

							// Step to next voxel boundary (also update which voxel face we entered through)
							// Deterministic tie-break to avoid flicker when distances are equal.
							const float TIE_EPS = 1e-6;
							bool xSmall = (tMaxX <= tMaxY + TIE_EPS) && (tMaxX <= tMaxZ + TIE_EPS);
							bool ySmall = (tMaxY <= tMaxX + TIE_EPS) && (tMaxY <= tMaxZ + TIE_EPS);
							bool zSmall = (tMaxZ <= tMaxX + TIE_EPS) && (tMaxZ <= tMaxY + TIE_EPS);

							// If multiple are "small", pick the axis with the largest |rayDir| for stability.
							vec3 absDir = abs(rayDir);
							if (xSmall && ySmall && zSmall) {
								if (absDir.x >= absDir.y && absDir.x >= absDir.z) { ySmall = false; zSmall = false; }
								else if (absDir.y >= absDir.x && absDir.y >= absDir.z) { xSmall = false; zSmall = false; }
								else { xSmall = false; ySmall = false; }
							} else if (xSmall && ySmall) {
								if (absDir.x >= absDir.y) { ySmall = false; } else { xSmall = false; }
							} else if (xSmall && zSmall) {
								if (absDir.x >= absDir.z) { zSmall = false; } else { xSmall = false; }
							} else if (ySmall && zSmall) {
								if (absDir.y >= absDir.z) { zSmall = false; } else { ySmall = false; }
							}

							if (xSmall) {
								enterFaceNormalWorld = vec3(-float(stepI.x), 0.0, 0.0);
								t = tMaxX;
								tMaxX += tDeltaX;
								v.x += stepI.x;
							} else if (ySmall) {
								enterFaceNormalWorld = vec3(0.0, -float(stepI.y), 0.0);
								t = tMaxY;
								tMaxY += tDeltaY;
								v.y += stepI.y;
							} else {
								enterFaceNormalWorld = vec3(0.0, 0.0, -float(stepI.z));
								t = tMaxZ;
								tMaxZ += tDeltaZ;
								v.z += stepI.z;
							}

                            // Exit if outside grid
                            if (v.x < gridLowerBound.x || v.y < gridLowerBound.y || v.z < gridLowerBound.z || v.x >= gridUpperBound.x || v.y >= gridUpperBound.y || v.z >= gridUpperBound.z) {
                                break;
                            }
                        }

                        #ifdef COLOR_PASS
                        return accumulatedColor;
                        #else
                        return vec4(-1.0); // no hit for depth and pick pass
                        #endif
                    }

					// Voxel-style shading: for DDA rendering we want crisp, grid-consistent results.
					// Shadow lookup is done at the true surface hit point.
					vec4 add_lighting_with_hitpos(float val, vec3 hit_pos_world, vec3 faceNormalWorld, vec3 outlineFootprint, bool picked)
					{
						vec4 posInLightClipSpace = lightMatrix * vec4(detransform(hit_pos_world), 1.0);
						posInLightClipSpace /= posInLightClipSpace.w;
						float posLightNdcDepth = posInLightClipSpace.z;
						vec2 lightMapUV = posInLightClipSpace.xy;
						float lightDepthFromMap = lightDepthMapIsRgba ? unpackRGBAToDepth(texture2D(lightDepthMap, lightMapUV)) : texture2D(lightDepthMap, lightMapUV).r;

						float bias = 0.01;
						float lightedByLightMap = (posLightNdcDepth > lightDepthFromMap + bias) ? 0.5 : 1.0;

						// Minecraft-like per-face lighting: face normal (axis-aligned) dotted with light direction.
						// Convert face normal from volume/world voxel coords into cube local coords (same space as lightDirection).
						vec3 nLocal = vec3(
							faceNormalWorld.z / max(displaySize.z, 1e-6),
							-faceNormalWorld.y / max(displaySize.y, 1e-6),
							-faceNormalWorld.x / max(displaySize.x, 1e-6)
						);
						nLocal = normalize(nLocal);
						vec3 L = normalize(lightDirection);
						float lightedByFaceNormal = clamp(2.5 * dot(nLocal, L), 0.0, 1.0); // magic factor to make front facing voxels brighter
						
						// Keep some ambient so shadowed faces aren't pitch black.
						float ambient = 0.75;
						float diffuse = 0.25 * clamp(lightedByFaceNormal * lightedByLightMap, 0.0, 1.0);

						vec4 color = apply_colormap(val);
						vec4 final_color = color;
						final_color.rgb = color.rgb * (ambient + diffuse);
						final_color.a = color.a;

						if (!picked) {
							// final_color = vec4(0.4);
							final_color.rgb *= 0.5; // dim non-picked voxels for better visibility of picked voxel
							final_color.a = 0.3;
						}

						float outline = voxelContourMask(hit_pos_world, faceNormalWorld, outlineFootprint);
						float outlineStrength = 1.0; // 0..1

						final_color.rgb = mix(final_color.rgb, vec3(0.0), outline * outlineStrength);

						return final_color;
						//return vec4(vec3(diffuse * 4.0), 1.0); // debug: shadows only
					}`
	
	};
	return VolumeRenderShader1;
}


export { getVolumeRenderShader };