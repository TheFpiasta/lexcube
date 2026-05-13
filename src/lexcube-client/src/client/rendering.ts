import { AmbientLight, BoxGeometry, DataTexture, DirectionalLight, FloatType, Mesh, MeshBasicMaterial, OrthographicCamera, PerspectiveCamera, Raycaster, RedFormat, RGBAFormat, RGBFormat, Scene, ShaderMaterial, Triangle, Vector2, Vector3, WebGLRenderer, Line, BufferGeometry, Object3D, LineBasicMaterial, Frustum, Matrix4, Plane, Box3, LineSegments, Float32BufferAttribute, SphereGeometry, MeshStandardMaterial, CylinderGeometry, AnimationMixer, AnimationClip, NumberKeyframeTrack, KeyframeTrack, InterpolateSmooth, BooleanKeyframeTrack, Clock, AnimationAction, AddEquation, CustomBlending, OneMinusSrcAlphaFactor, SrcAlphaFactor, Color, MaxEquation, OneFactor, MinEquation, AlwaysStencilFunc, ReplaceStencilOp, GridHelper, Euler, UniformsUtils, BackSide, EdgesGeometry, Ray, IUniform, PCFSoftShadowMap, Event, LoopOnce, MeshPhongMaterial, MathUtils, AxesHelper, PlaneGeometry, DoubleSide, BufferAttribute, AdditiveBlending, LinearFilter, WebGLRenderTarget, NearestFilter, Matrix3, NeverDepth, AlwaysDepth, UnsignedByteType, WebGLArrayRenderTarget, BasicShadowMap, CameraHelper, FrontSide, PCFShadowMap, ClampToEdgeWrapping, GLSL3, RedIntegerFormat, UnsignedIntType } from 'three';
import { clamp, inverseLerp, lerp } from 'three/src/math/MathUtils';
import { toPng, toCanvas, getFontEmbedCSS, toBlob } from 'html-to-image';
import { getVolumeRenderShader } from './rendering/volume-rendering'
import { COLORMAP_STEPS, CubeFace, DEFAULT_FOV, DEFAULT_WIDGET_HEIGHT, DEFAULT_WIDGET_WIDTH, Dimension, getAddressedFacesOfDimension, getFacesOfIndexDimension, MAXIMUM_SUPPORTED_LOD, FLOAT_NAN_REPLACEMENT_VALUE, FLOAT_NOT_LOADED_REPLACEMENT_VALUE, range, TILE_SIZE_2D, TILE_SIZE_3D, RGB_NOT_LOADED_ALPHA_VALUE, RGB_NAN_ALPHA_VALUE, DataType, PERSPECTIVE_MIN_DISTANCE, PERSPECTIVE_MAX_DISTANCE, ORTHOGRAPHIC_MIN_ZOOM, ORTHOGRAPHIC_MAX_ZOOM, TILES_TEXTURE_NAME, RaycastResultType, saveFloatArrayAsPNG, INVALID_LOD_PLACEHOLDER } from './constants';
import Stats from 'three/examples/jsm/libs/stats.module'
import { CubeClientContext } from './client';
import { CubeDimensions, CubeSelection, ParameterRange } from './interaction';
import { FontData, FontLoader } from 'three/examples/jsm/loaders/FontLoader';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';

import PinModel from './pin.glb'
import { Tile2D, Tile3D, Tile3DClipBoundary } from './tiledata';

import { MultiBlockRenderPass, TileTextureView2D, TileTextureView3D, TileTextureView2DUpdateResult, TileTextureView3DUpdateResult } from './rendering/tile-texture-views';
import { RecordingFileFormat, FixedFrameCanvasRecorder, FixedFrameGifCanvasRecorder, FixedFrameVideoEncoderCanvasRecorder } from './rendering/export-recorder';
import { RegionBorderManager, NaturalEarthRegionBorderResolution, RegionBorderHostState } from './rendering/region-borders';
import { MaxRangeIndicatorManager } from './rendering/max-range-indicators';
import { AsyncPickRing } from './rendering/picking';


class LabelPositionResult {
    visible: boolean = false;
    screenPositionMinLabel!: Vector2;
    screenPositionMaxLabel!: Vector2; 
    screenPositionNameLabel!: Vector2; 
    angleMinLabel!: number; 
    angleMaxLabel!: number; 
    angleNameLabel!: number; 
}

class Edge {
    p1: Vector3;
    p2: Vector3;
    dimension: Dimension;

    constructor(p1: Vector3, p2: Vector3, dimension: Dimension) {
        this.p1 = p1;
        this.p2 = p2;
        this.dimension = dimension;
    }

    clone() {
        return new Edge(this.p1, this.p2, this.dimension);
    }

    sharesP1With(other: Edge) {
        return this.p1.equals(other.p1) || this.p1.equals(other.p2);
    }

    sharesP2With(other: Edge) {
        return this.p2.equals(other.p1) || this.p2.equals(other.p2);
    }
    
    middle() {
        return this.p1.clone().add(this.p2).divideScalar(2);
    }

    equals(other: Edge) {
        return this.p1.equals(other.p1) && this.p2.equals(other.p2) && this.dimension == other.dimension;
    }

    isIdenticalLine(other: Edge) {
        return (this.p1.equals(other.p1) && this.p2.equals(other.p2));
    }

    lerpedWith(other: Edge) {
        return new Edge(new Vector3().lerpVectors(this.p1, other.p1, 0.5), new Vector3().lerpVectors(this.p2, other.p2, 0.5), this.dimension);
    }

    reverse() {
        const newP1 = this.p2;
        this.p2 = this.p1;
        this.p1 = newP1;
    }

    getDirection() {
        return this.p2.clone().sub(this.p1);
    }
}

class CubeRendering {
    private renderer: WebGLRenderer;
    orthographicCamera: OrthographicCamera;
    perspectiveCamera: PerspectiveCamera;

    private scene: Scene;
    tile2dFaceRenderedCube: Mesh<BoxGeometry, ShaderMaterial[]>;
    tile3dVolumeRenderedCube: Mesh<BoxGeometry, ShaderMaterial>;
    tile3dVolumeRenderedCubePickMaterial: ShaderMaterial;

    private tile2dFaceRenderedCubeTileTextureViews: TileTextureView2D[][] = [];
    private tile3dVolumeRenderedCubeTileTextureViews: TileTextureView3D[] = [];

    volumeRenderingEnabled: boolean = false;
    
    displayQuality = 1.0;

    private totalSizes2D: Vector2[];
    private totalSize3D: Vector3;
    lods2d: number[];
    lod3d: number = -1;
    faceVisibility: Array<boolean> = new Array(6).fill(false);

    private faceCurrentPixels: number[] = [0,0,0,0,0,0];
    private rayCaster: Raycaster = new Raycaster();
    private context: CubeClientContext;
    
    private orthographicCameraFrustumSize = 3;
    
    private colormapData: Uint8Array;
    renderDebugCubes: boolean;
    debugCubes: Mesh[];
    private allTilesDownloaded: boolean = false;
    private parent: HTMLElement;

    private renderRequested: boolean = true;
    
    private contextLayerParentFront!: Object3D;
    private contextLayerMarkerMaterial!: MeshPhongMaterial;
    private contextLayerClipPlanes: Map<CubeFace, Plane> = new Map<CubeFace, Plane>();
    private contextLayerClipDistanceFromCubeCenter = 0.499; // just a bit inside the cube

    private regionBorders!: RegionBorderManager;
    private maxRangeIndicators!: MaxRangeIndicatorManager;

    private regionBordersDistanceFromCubeCenterInRenderWorld: Vector3;
    private regionBordersDistanceFromCubeCenterOffset: number = 0.001;

    updateWidgetModelDimensionWrapSettings: (xWrap: boolean, yWrap: boolean, zWrap: boolean) => void = () => {};

    private canvasRecorder: FixedFrameCanvasRecorder | null = null;
    private recordingAnimation: boolean = false;

    private htmlClassesOptionalForScreenshots = ["bottom-left-ui", "axis-label-ui", "dataset-info-corner-parent"];
    private htmlClassesAlwaysInScreenshots = ["corner-logo-ui", "attribution-banner"];
    private htmlClassesNeverInScreenshots = ["hover-info-ui", "colormap-options"];
    private recordingFileFormat: RecordingFileFormat | null = RecordingFileFormat.MP4;

    private screenshotFontEmbedCss: string = "";

    private lastLabelEdges: (Edge | undefined)[] = [undefined, undefined, undefined];

    private debouncedVisibilityAndLodUpdateTimeoutHandler: number = 0;
    printTemplateDownloading: boolean = false;
    private printTemplateCurrentFace: number = 0;
    private printTemplateResults: string[] = [];
    
    private printTemplateCamera: OrthographicCamera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 100);
    dimensionOverflow: boolean[] = [false, false, false];
    
    private widgetModeWidth = DEFAULT_WIDGET_WIDTH;
    private widgetModeHeight = DEFAULT_WIDGET_HEIGHT;

    private outlineCubeForVolumeRendering: LineSegments<EdgesGeometry<BoxGeometry>, LineBasicMaterial>;
    private frontLight: DirectionalLight;

    private volumeRenderingThresholdSign = -1; // -1 = show all values less than X, 1 = show all values greater than X
    private volumeRenderingRenderStyle: number = 0;
    private volumeRenderingQuantileThreshold: number = 1.0;
    private volumeRenderingAbsoluteThreshold: number = 1.0;
    private volumeRenderingRangeLowerThreshold: number = 0.0;
    private volumeRenderingRangeUpperThreshold: number = 1.0;

    private volumeRenderingUseQuantileOverAbsoluteThreshold: boolean = false;

    // private statsPanel: Stats;
    private volumeRenderingFloor!: Mesh;
    private maxTextureSize2D: number;

    private pickRing3d: AsyncPickRing;
    private pending3dPick: boolean = false;
    private pending3dPickMousePosition: Vector2 = new Vector2();
    private readonly cube3dPickRenderLayer = 1;
   
    constructor(context: CubeClientContext, parent: HTMLElement) {
        this.context = context;
        this.parent = parent;
        this.colormapData = new Uint8Array(COLORMAP_STEPS * 4);
        this.colormapData.fill(128);

        this.totalSizes2D = new Array<Vector2>();
        this.totalSize3D = new Vector3();
        this.lods2d = new Array<number>();

        this.scene = new Scene();

        // set up isometric camera
        const aspect = this.getWidth() / this.getHeight();
        this.orthographicCamera = new OrthographicCamera(this.orthographicCameraFrustumSize * aspect / - 2, this.orthographicCameraFrustumSize * aspect / 2, this.orthographicCameraFrustumSize / 2, this.orthographicCameraFrustumSize / - 2, 0.01, 10);
        
        this.orthographicCamera.lookAt(0, 0, 0);
        this.orthographicCamera.zoom = 0.5;
        this.orthographicCamera.position.set(1, 1, 1).setLength(2.5);
        // this.orthographicCamera.updateProjectionMatrix();

        // this.scene.add(this.orthographicCamera);

        // set up perspective camera
        let fov = 30;
        const matchFov = document.URL.match(/fov=(\d+\.?\d*)/);
        if (matchFov && matchFov.length > 0) {
            fov = parseInt(matchFov[1]);
        }
        this.perspectiveCamera = new PerspectiveCamera(fov, this.getWidth() / this.getHeight(), 0.01, 100);
        // this.scene.add(this.perspectiveCamera);

        

        this.frontLight = new DirectionalLight("white", 1.0);
        this.frontLight.position.set(0.2, 1.4, -0.4);
        this.frontLight.target.position.set(0, 0, 0);
        this.frontLight.target.updateMatrixWorld();
        this.frontLight.castShadow = true;
        this.frontLight.shadow.mapSize.width = 2048;
        this.frontLight.shadow.mapSize.height = 2048;
        // this.frontLight.shadow.radius = 4;
        this.frontLight.shadow.bias = -0.0001;
        this.frontLight.shadow.camera.near = 0.7;
        this.frontLight.shadow.camera.far = 2.4;
        this.frontLight.shadow.camera.left = -1;
        this.frontLight.shadow.camera.right = 1;
        this.frontLight.shadow.camera.top = 1;
        this.frontLight.shadow.camera.bottom = -1;
        this.frontLight.shadow.camera.updateMatrixWorld(true);

        // const helper = new CameraHelper(this.frontLight.shadow.camera);
        // this.scene.add(helper);


        // const backLight = new DirectionalLight("white", 0.4);
        // backLight.position.set(-1.0, 1.4, 0.7);

        const ambientLight = new AmbientLight("white", 0.5);
    
        this.renderer = new WebGLRenderer({ 
            antialias: true, 
            alpha: this.context.studioMode || this.context.widgetMode,
            preserveDrawingBuffer: true
        });

        this.maxTextureSize2D = this.renderer.getContext().getParameter(this.renderer.getContext().MAX_TEXTURE_SIZE);

        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = PCFShadowMap;
        this.renderer.shadowMap.autoUpdate = false;
        this.renderer.shadowMap.needsUpdate = true;
        this.renderer.setSize(this.getWidth(), this.getHeight());
        this.renderer.setPixelRatio(window.devicePixelRatio);
        // this.renderer.setClearColor(new Color("#000000"), 0);
        this.parent.appendChild(this.renderer.domElement);

        window.addEventListener('resize', this.onWindowResize.bind(this), false)

        // this.statsPanel = new Stats();
        // this.statsPanel.showPanel(1); // 0: fps, 1: ms, 2: mb, 3+: custom
        // if (this.context.debugMode) {
        //     document.body.appendChild(this.statsPanel.dom);
        // }
        
        this.pickRing3d = new AsyncPickRing(this.renderer, () => this.renderPickPass());         
        
        const scale = this.getCubeScaleInRenderWorld();
        const cubeGeometry = new BoxGeometry(scale.x, scale.y, scale.z);
        const cube3DGeometry = new BoxGeometry(scale.x, scale.y, scale.z);      

        this.regionBordersDistanceFromCubeCenterInRenderWorld = scale.clone().multiplyScalar(0.5).addScalar(this.regionBordersDistanceFromCubeCenterOffset); // just a bit in front of the cube, based on its scale

        const materials = Array.from({ length: 6 }, () => this.newCubeMaterial());
        this.tile2dFaceRenderedCube = new Mesh(cubeGeometry, materials);
        this.tile2dFaceRenderedCube.userData = { isCube: true }; // for raycasting identification

        this.tile3dVolumeRenderedCube = new Mesh(cube3DGeometry, this.newCubeMaterial3D());
        this.tile3dVolumeRenderedCube.userData = { isCube: true }; // for raycasting identification
        this.tile3dVolumeRenderedCube.layers.toggle(this.cube3dPickRenderLayer);
        
        this.blockBasedVolumeRenderingImposterBillboardsParent = new Object3D();
        this.scene.add(this.blockBasedVolumeRenderingImposterBillboardsParent);

        // for debugging, for now
        // const hintCube = new Mesh(new BoxGeometry(1, 1, 1), new MeshBasicMaterial({ color: "white", wireframe: true, opacity: 0.1, transparent: true }));
        // this.blockBasedVolumeRenderingIntermediateScene.add(hintCube);

        this.tile2dFaceRenderedCube.castShadow = true;
        this.tile3dVolumeRenderedCube.castShadow = true;
        this.tile3dVolumeRenderedCube.customDepthMaterial = this.newCubeMaterial3D(false, this.tile3dVolumeRenderedCube.material.uniforms, true);
        this.tile3dVolumeRenderedCubePickMaterial = this.newCubeMaterial3D(false, this.tile3dVolumeRenderedCube.material.uniforms, false, true);

        // draw debug cube for 3D cube
        const edgesGeometry = new EdgesGeometry(cube3DGeometry);
        this.outlineCubeForVolumeRendering = new LineSegments(edgesGeometry, new LineBasicMaterial({ color: "white" }));
        this.scene.add(this.outlineCubeForVolumeRendering);

        // new grid helper
        const grid = new GridHelper( 6, 6, 0xffffff, 0xffffff );
        // this.scene.add( grid );
    
        const floorGeometry = new BoxGeometry(1.6, 0.001, 1.6);
        const floorMaterial = new MeshStandardMaterial({ color: "#6f6f6f", roughness: 1.0, metalness: 0.0 });
        this.volumeRenderingFloor = new Mesh(floorGeometry, floorMaterial);
        this.volumeRenderingFloor.position.set(0, -0.509, 0);
        this.volumeRenderingFloor.position.multiply(this.getCubeScaleInRenderWorld());
        this.volumeRenderingFloor.receiveShadow = true;

        this.scene.add(this.volumeRenderingFloor);
        
        // const hintCube = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), new MeshBasicMaterial({ color: "white" }));
        // this.scene.add(hintCube);
        // hintCube.castShadow = true;
        
        this.set2dCubeLightingEnabled();
    
        this.renderDebugCubes = false;
        this.debugCubes = [];
        if (this.renderDebugCubes) {
            for (let i = 0; i < 20; i++) {
                const c = new Mesh(new BoxGeometry(0.02, 0.02, 0.02), new MeshBasicMaterial({ color: ["white","grey","yellow","green","purple"][i % 5] }));
                this.debugCubes.push(c)
                this.scene.add(c);
            }
        }
    
        // fix 2D cube UVs
        var uvAttributes = this.tile2dFaceRenderedCube.geometry.attributes.uv;
        for (let face = 0; face < 6; face++) {
            const offset = face * 4;
    
            if (face == CubeFace.Front) {
                // UV = from top left to bottom right of face
                uvAttributes.setXY(offset + 0, 0, 0); // top left
                uvAttributes.setXY(offset + 1, 1, 0); // top right
                uvAttributes.setXY(offset + 2, 0, 1); // bottom left
                uvAttributes.setXY(offset + 3, 1, 1); // bottom right
            } else if (face == CubeFace.Back) {
                // UV = from top right to bottom left of face
                uvAttributes.setXY(offset + 0, 1, 0); // top left
                uvAttributes.setXY(offset + 1, 0, 0); // top right
                uvAttributes.setXY(offset + 2, 1, 1); // bottom left
                uvAttributes.setXY(offset + 3, 0, 1); // bottom right
            } else if (face == CubeFace.Right) {
                // UV = from top left to bottom right of face, but XY flipped
                uvAttributes.setXY(offset + 0, 0, 1); // top left
                uvAttributes.setXY(offset + 1, 0, 0); // top right
                uvAttributes.setXY(offset + 2, 1, 1); // bottom left
                uvAttributes.setXY(offset + 3, 1, 0); // bottom right
            } else if (face == CubeFace.Top) {
                // UV = from bottom right to top left of face, but XY flipped
                uvAttributes.setXY(offset + 0, 1, 0); // top left
                uvAttributes.setXY(offset + 1, 1, 1); // top right
                uvAttributes.setXY(offset + 2, 0, 0); // bottom left
                uvAttributes.setXY(offset + 3, 0, 1); // bottom right
            } else if (face == CubeFace.Bottom || face == CubeFace.Left) {
                // UV = from top right to bottom left of face, but XY flipped
                uvAttributes.setXY(offset + 0, 0, 0); // top left
                uvAttributes.setXY(offset + 1, 0, 1); // top right
                uvAttributes.setXY(offset + 2, 1, 0); // bottom left
                uvAttributes.setXY(offset + 3, 1, 1); // bottom right
            }
        }

        this.tile2dFaceRenderedCube.visible = false;
        this.tile3dVolumeRenderedCube.visible = false;
    
        this.scene.add(this.tile2dFaceRenderedCube);
        this.scene.add(this.tile3dVolumeRenderedCube);
        this.scene.add(this.frontLight);
        // this.scene.add(backLight);
        this.scene.add(ambientLight);

        // Initialize region borders manager
        const regionBorderHost: RegionBorderHostState = {
            get faceVisibility() { return self.faceVisibility; },
            get dimensionOverflow() { return self.dimensionOverflow; },
            get printTemplateDownloading() { return self.printTemplateDownloading; },
            get printTemplateJustDownloaded() { return self.printTemplateJustDownloaded; },
            get getCubeScaleInRenderWorld() { return () => self.getCubeScaleInRenderWorld(); },
            requestRender: () => self.requestRender(),
        };
        const self = this;
        this.regionBorders = new RegionBorderManager(context, this.scene, this.renderer, regionBorderHost);

        this.contextLayerClipPlanes.set(CubeFace.Top, new Plane(new Vector3(0, 1, 0), this.contextLayerClipDistanceFromCubeCenter));
        this.contextLayerClipPlanes.set(CubeFace.Bottom, new Plane(new Vector3(0, -1, 0), this.contextLayerClipDistanceFromCubeCenter));
        this.contextLayerClipPlanes.set(CubeFace.Left, new Plane(new Vector3(0, 0, 1), this.contextLayerClipDistanceFromCubeCenter));
        this.contextLayerClipPlanes.set(CubeFace.Right, new Plane(new Vector3(0, 0, -1), this.contextLayerClipDistanceFromCubeCenter));

        this.contextLayerMarkerMaterial = new MeshPhongMaterial({
            color: "white",
            // transparent: true,
            // opacity: 1,
            clippingPlanes: Array.from(this.contextLayerClipPlanes.values())
        });

        this.contextLayerParentFront = new Object3D();
        this.scene.add(this.contextLayerParentFront);

        // Initialize max range indicators manager
        this.maxRangeIndicators = new MaxRangeIndicatorManager(this.scene, () => this.requestRender(), this.getCubeScaleInRenderWorld());
        this.maxRangeIndicators.create();
        
        (window as any)["saveCameraPreset"] = () => {
            const s = `{ position: new Vector3(${this.getCurrentCamera().position.x}, ${this.getCurrentCamera().position.y}, ${this.getCurrentCamera().position.z}), rotation: new Euler(${this.getCurrentCamera().rotation.x}, ${this.getCurrentCamera().rotation.y}, ${this.getCurrentCamera().rotation.z}) },`
            console.log(s)
        }
    }

    private getCubeScaleInRenderWorld() {
        return new Vector3(this.context.cubeScale[2], this.context.cubeScale[1], this.context.cubeScale[0]);
    }

    showAllMaxRangeIndicators() {
        this.maxRangeIndicators.showAll();
    }

    showMaxRangeIndicator(face: CubeFace, dimension: Dimension, min: boolean) {
        this.maxRangeIndicators.show(face, dimension, min);
    }

    loadRegionBordersFromGeoJsonForWidget(geojson: any, color: string = "") {
        this.regionBorders.loadFromGeoJsonForWidget(geojson, color);
    }

    clearRegionBordersForWidget() {
        this.regionBorders.clearForWidget();
    }

    setRegionBordersColor(color: string) {
        this.regionBorders.setColor(color);
    }

    async updateRegionBorderPositionAndResolution() {
        ///// Time series marker /////

        const indexValueLeft = this.context.interaction.cubeSelection.getIndexValueForFace(CubeFace.Left);
        const indexValueRight = this.context.interaction.cubeSelection.getIndexValueForFace(CubeFace.Right);
        const indexValueTop = this.context.interaction.cubeSelection.getIndexValueForFace(CubeFace.Top);
        const indexValueBottom = this.context.interaction.cubeSelection.getIndexValueForFace(CubeFace.Bottom);

        const xTotalRangeNumeric = this.context.interaction.cubeDimensions.getCubeDimensionByDimension(Dimension.X).steps;
        const yTotalRangeNumeric = this.context.interaction.cubeDimensions.getCubeDimensionByDimension(Dimension.Y).steps;
        const xSelectedRangeNumeric = new ParameterRange(indexValueLeft, indexValueRight + 1);
        const ySelectedRangeNumeric = new ParameterRange(indexValueTop, indexValueBottom + 1);
        const selectionCenterPointNumeric = new Vector2(xSelectedRangeNumeric.middle() - 0.5, ySelectedRangeNumeric.middle() - 0.5);
        const datasetCenterPointNumeric = new Vector2((xTotalRangeNumeric) / 2,(yTotalRangeNumeric) / 2);
        const datasetSizeNumeric = new Vector2(xTotalRangeNumeric, yTotalRangeNumeric);
        const selectionSizeNumeric = new Vector2(xSelectedRangeNumeric.range(), ySelectedRangeNumeric.range());
        const zoomRelativeToDatasetNumeric = new Vector2().copy(datasetSizeNumeric).divide(selectionSizeNumeric);

        const normalizationMatrixNumeric = new Matrix4() // normalizes numeric data that fits into the dataset bounds to [-0.5, 0.5] x [-0.5, 0.5]
            .multiply(new Matrix4().makeScale(1, 1 / datasetSizeNumeric.y, 1 / datasetSizeNumeric.x))
            .multiply(new Matrix4().makeTranslation(0.5 + this.timeSeriesPinDepth * 0.6, datasetCenterPointNumeric.y, -datasetCenterPointNumeric.x));
            // todo: maybe rotate here for other faces

        const finalMatrixNumeric = new Matrix4()
            .makeTranslation(
                0,
                zoomRelativeToDatasetNumeric.y * (selectionCenterPointNumeric.y - datasetCenterPointNumeric.y) / datasetSizeNumeric.y, // positive data Y = positive global Y
                zoomRelativeToDatasetNumeric.x * (selectionCenterPointNumeric.x + datasetCenterPointNumeric.x) / datasetSizeNumeric.x  // positive data X = negative global Z
            )
            .multiply(new Matrix4().makeScale(1, zoomRelativeToDatasetNumeric.y, zoomRelativeToDatasetNumeric.x)) // apply zoom
            .multiply(normalizationMatrixNumeric);

        this.contextLayerParentFront.matrixAutoUpdate = false;
        this.contextLayerParentFront.matrix.identity();
        this.contextLayerParentFront.applyMatrix4(finalMatrixNumeric);
        this.contextLayerParentFront.updateMatrixWorld(true); // needs force. alternatively: .matrixWorldNeedsUpdate = true;

        for (let marker of this.contextLayerParentFront.children) {
            marker.scale.set(1, datasetSizeNumeric.y / zoomRelativeToDatasetNumeric.y, datasetSizeNumeric.x / zoomRelativeToDatasetNumeric.x);
            marker.updateMatrixWorld(true);
        }

        ///// Front region borders /////
        await this.regionBorders.updatePositionAndResolution();
    }

    transitionBetweenCameraStyles(previousCamera: PerspectiveCamera | OrthographicCamera, newCamera: PerspectiveCamera | OrthographicCamera) {
        // this.context.interaction.updateControlsCamera(this.getCurrentCamera());
        
        const newPosition = previousCamera.position.clone().multiplyScalar(newCamera.position.length() / previousCamera.position.length());
        newCamera.position.copy(newPosition);
        newCamera.rotation.copy(previousCamera.rotation);

        if (newCamera instanceof OrthographicCamera) {
            // perspective distance converted to ortho zoom
            const p = clamp(inverseLerp(PERSPECTIVE_MIN_DISTANCE, PERSPECTIVE_MAX_DISTANCE, previousCamera.position.length()), 0, 1);
            const z = lerp(ORTHOGRAPHIC_MIN_ZOOM, ORTHOGRAPHIC_MAX_ZOOM, 1 - p)
            newCamera.zoom = z;
        } else {
            // ortho zoom converted to perspective distance
            const p = clamp(inverseLerp(ORTHOGRAPHIC_MIN_ZOOM, ORTHOGRAPHIC_MAX_ZOOM, previousCamera.zoom), 0, 1);
            newCamera.position.copy(newPosition).setLength(lerp(PERSPECTIVE_MIN_DISTANCE, PERSPECTIVE_MAX_DISTANCE, 1 - p));
        }

        this.context.log("[transitionBetweenCameraStyles] Old camera, zoom", previousCamera.zoom, "distance", previousCamera.position.length())
        this.context.log("[transitionBetweenCameraStyles] New camera, zoom", newCamera.zoom, "distance", newCamera.position.length());
        // this.context.interaction.updateControls();
        this.onWindowResize();
    }

    private first3dLodReveal = false;
    private playAnimationOnNext3dLodReveal = false;

    toggleVolumeRenderingMode(volumeRenderingEnabled: boolean, updateAndRender: boolean = true) {
        if (volumeRenderingEnabled && !this.volumeRenderingEnabled) {
            this.updateLod3d();
            this.context.interaction.showResolutionChangeInfo(this.lod3d);
            this.first3dLodReveal = true;
        }

        this.volumeRenderingEnabled = volumeRenderingEnabled;
        this.tile3dVolumeRenderedCube.visible = false;
        this.tile2dFaceRenderedCube.visible = true;
        this.context.log("Toggling volume rendering mode:", volumeRenderingEnabled);

        // this.blockBasedVolumeRenderingSubCubesParent.visible = volumeRenderingEnabled;
        this.blockBasedVolumeRenderingImposterBillboardsParent.visible = volumeRenderingEnabled;
        
        this.renderer.setClearColor(new Color(volumeRenderingEnabled ? "black" : "black"), 1);
        this.regionBorders.getFrontMaterial().color.set(volumeRenderingEnabled ? "white": "black");
        this.regionBorders.getSideMaterial().visible = !volumeRenderingEnabled;
        // this.regionBorders.getFrontMaterial().transparent = !volumeRenderingEnabled;
        this.regionBorders.getSideMaterial().transparent = !volumeRenderingEnabled;
        this.outlineCubeForVolumeRendering.visible = volumeRenderingEnabled;

        // this.cameraChanged();
        if (updateAndRender) {
            this.updateVisibilityAndLods();
            this.requestRender();
        }
    }

    set2dCubeLightingEnabled(lightEnabled: boolean = !(this.context.studioMode || this.context.widgetMode || this.context.orchestrationMinionMode)) {
        // front, back, top, bottom, left, right
        const lightStrengths = [ 0.0, 0.0, -0.05, -0.1, -0.15, -0.15 ]; // comes from the front?
        for (let i = 0; i < 6; i++) {
            this.tile2dFaceRenderedCube.material[i].uniforms["lightStrength"].value = lightEnabled ? lightStrengths[i] : 0.0;
        }
    }

    getLocalEventPosition(event: Touch | MouseEvent) {
        const brect = this.parent.getBoundingClientRect();
        return new Vector2(event.pageX - brect.left, event.pageY - brect.top);
    }

    getDomElement() {
        return this.renderer.domElement;
    }

    private gltfLoader: GLTFLoader = new GLTFLoader();
    private pinModel: Mesh<BufferGeometry, MeshPhongMaterial> | undefined;
    private timeSeriesPinWidthHeight = 0.07;
    private timeSeriesPinDepth = 0.15;

    private loadModels() {
        // load gltf from "pin.glb"
        this.gltfLoader.load(PinModel, (gltf) => {
            this.pinModel = gltf.scene.children[0].children[0] as Mesh<BufferGeometry, MeshPhongMaterial>;
            const size = new Box3().setFromObject(this.pinModel).getSize(new Vector3());
            this.pinModel.scale.set(this.timeSeriesPinWidthHeight / size.x, this.timeSeriesPinWidthHeight / size.y, this.timeSeriesPinDepth / size.z);
            this.pinModel.rotateX(-Math.PI / 2); // todo: do this later in the matrix multiplication chain
            this.pinModel.rotateY(Math.PI / 2);
            this.pinModel.geometry.computeVertexNormals();
        });
    }

    startup() {
        this.loadModels();
        this.context.interaction.updateVolumeVizRenderStyleFromUi();
        this.prepareVolumeRenderImposterBillboards();
        this.animate();
    }
    
    getPercentualFaceVisibility(face: CubeFace) {
        const allPixels = this.faceCurrentPixels.reduce((previous, current, currentIndex) => this.faceVisibility[currentIndex] ? previous + current : previous);
        return this.faceVisibility[face] ? this.faceCurrentPixels[face] / allPixels : 0;
    }
    
    resetForNewParameter() {
        this.totalSizes2D = new Array<Vector2>();
        this.totalSize3D = new Vector3();
        this.lods2d = new Array<number>();
        this.lod3d = INVALID_LOD_PLACEHOLDER;
        const dims = this.context.interaction.cubeDimensions;
        const sel = this.context.interaction.cubeSelection;

        const matchTimeScale = document.URL.match(/cubeTimeScale=(\d+\.?\d*)/);
        if (matchTimeScale && matchTimeScale.length > 0) {
            this.tile2dFaceRenderedCube.scale.set(parseFloat(matchTimeScale[1]), 1, 1);
        }

        for (let face = 0; face < 6; face++) {
            const width = dims.totalWidthForFace(face);
            const height = dims.totalHeightForFace(face);
            this.totalSizes2D.push(new Vector2(width, height));
            this.lods2d.push(INVALID_LOD_PLACEHOLDER);
            this.tile2dFaceRenderedCube.material[face].uniforms["totalSize"].value = this.totalSizes2D[face];
            sel.setUniformLocations2d(face, this.tile2dFaceRenderedCube.material[face].uniforms["displaySize"], this.tile2dFaceRenderedCube.material[face].uniforms["displayOffset"])
            this.tile2dFaceRenderedCube.material[face].uniforms["lod"].value = this.lods2d[face];
        }

        this.totalSize3D = dims.totalSize();
        this.tile3dVolumeRenderedCube.material.uniforms["totalSize"].value.set(this.totalSize3D.x, this.totalSize3D.y, this.totalSize3D.z);
        sel.setUniformLocations3d(this.tile3dVolumeRenderedCube.material.uniforms["displaySize"], this.tile3dVolumeRenderedCube.material.uniforms["displayOffset"]);
        this.tile3dVolumeRenderedCube.material.uniforms["lod"].value = this.lod3d;

        this.playAnimationOnNext3dLodReveal = true;

        console.log("New total size 3D", this.totalSize3D);
    }


    // Convert data coordinates (X=longitude, left>right), (Y=latitude, up>down), (Z=time, back>front) [syntax: low values > high values]
    // to render world coordinates (x=back>front, y=down>up, z=right>left)
    dataCoordinatesToRenderWorldCoordinates(dataCoordinates: Vector3): Vector3 {
        return new Vector3(
            dataCoordinates.z,
            -dataCoordinates.y,
            -dataCoordinates.x
        );
    }

    renderWorldCoordinatesToDataCoordinates(renderWorldCoordinates: Vector3): Vector3 {
        return new Vector3(
            -renderWorldCoordinates.z,
            -renderWorldCoordinates.y,
            renderWorldCoordinates.x
        );
    }

    dataScaleToRenderWorldScale(dataScale: Vector3): Vector3 {
        return new Vector3(
            dataScale.z,
            dataScale.y,
            dataScale.x
        );
    }


    // URL TO TEST (scale 1:1:1):
    // http://localhost:8080/?debug,isometric!esdc-3.0.2/air_temperature_2m/0-512/0-512/104-616

    private readonly BLOCK_BASED_VOLUME_RENDER_MAX_RENDER_PASSES = 16;

    private blockBasedVolumeRenderingImposterBillboardsParent!: Object3D;
    private blockBasedVolumeRenderingImposterBillboards: Mesh<PlaneGeometry, ShaderMaterial>[] = [];

    prepareVolumeRenderImposterBillboards() {
        // each billboard corresponds to a 3D tile (currently 256³ data units)


        const newImpostorBillboardMaterial = () => {
            const vertexShader = /* glsl */`
                    varying vec2 vUv;
    
                    uniform float ndcWidth;
                    uniform float ndcHeight;
                    uniform vec2 ndcPosition;
                    uniform float ndcDepth;
    
                    void main() {
                        vUv = uv;
                        vec2 scaledPosition = position.xy * vec2(ndcWidth, ndcHeight);
                        vec2 finalPosition = scaledPosition + ndcPosition;
                        gl_Position = vec4(finalPosition, ndcDepth, 1.0);
                    }
    
                `;
            const fragmentShader = /* glsl */`
                    varying vec2 vUv;

                    uniform sampler2DArray viewTile;
                    uniform float layer;

                    void main() {
                        vec4 viewTileResult = texture(viewTile, vec3(vUv, layer)).rgba;
                        if (viewTileResult.a < 0.01) {
                            discard;
                        }
                        gl_FragColor = vec4(viewTileResult.rgb, viewTileResult.a);
                    }
                `;
            
            return new ShaderMaterial({
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                side: DoubleSide,
                
                transparent: true,
                depthTest: true,
                depthWrite: false,
                
                uniforms: {
                    ndcWidth: { value: 1 },
                    ndcHeight: { value: 1 },
                    ndcPosition: { value: new Vector2(0, 0) },
                    ndcDepth: { value: 0.5 },
                    layer: { value: 0 },
                    viewTile: { value: null },
                }
            });
        }

        this.blockBasedVolumeRenderingImposterBillboards = [];

        for (let lod = 0; lod < MAXIMUM_SUPPORTED_LOD; lod++) {
            for (let renderPass = 0; renderPass < this.BLOCK_BASED_VOLUME_RENDER_MAX_RENDER_PASSES; renderPass++) {
                const imposterBillboard = new Mesh(new PlaneGeometry(1, 1), newImpostorBillboardMaterial());
                
                this.blockBasedVolumeRenderingImposterBillboardsParent.add(imposterBillboard);
                imposterBillboard.userData = {
                    lod: lod,
                    renderPass: renderPass,
                }
                this.blockBasedVolumeRenderingImposterBillboards.push(imposterBillboard);
            }
        }

    }

    applyCameraPreset(c: { name: string; position: Vector3; rotation: Euler; }, isDefaultPreset: boolean, cameraOverride?: OrthographicCamera, fromWidgetMode: boolean = false) {
        // TODO: integrate this
        // let position = c.position.clone();
        const camera = cameraOverride || this.perspectiveCamera;
        if (isDefaultPreset && !this.context.rendering.printTemplateDownloading && !this.context.isometricMode) {
            this.context.rendering.adjustCameraPresetToCube(c.position);
        }
        let positionForPerspectiveCamera = c.position.clone();
        const rotation = c.rotation;
        
        const targetCamera = camera;
        targetCamera.zoom = 1;
        targetCamera.position.copy(positionForPerspectiveCamera);
        targetCamera.rotation.set(rotation.x, rotation.y, rotation.z);
        targetCamera.updateMatrixWorld();
        targetCamera.updateProjectionMatrix();

        if (!this.printTemplateDownloading) {
            this.transitionBetweenCameraStyles(this.perspectiveCamera, this.orthographicCamera);
            this.context.interaction.updateControls(fromWidgetMode);
            this.updateCameras();
        }
        
        this.requestRender(false);
    }

    raycastWindowPosition(mouseX: number, mouseY: number, contextLayerAllowed: boolean = false) {
        const x = (mouseX / this.getWidth()) * 2 - 1;
        const y = -(mouseY / this.getHeight()) * 2 + 1;
        const ray = this.raycastNdc(new Vector2(x, y), contextLayerAllowed);
        const type = ray.length == 0 ? RaycastResultType.Background : ray[0].object.userData.isCube ? RaycastResultType.Cube : RaycastResultType.ContextLayer;
        return { ray, type };
    }

    getWidth() {
        if (this.context.widgetMode && !(this.context.interaction && this.context.interaction.fullscreenActive)) {
            return this.widgetModeWidth;
        } else {
            return window.innerWidth;
        }
    }

    getHeight() {
        if (this.context.widgetMode && !(this.context.interaction && this.context.interaction.fullscreenActive)) {
            return this.widgetModeHeight;
        } else {
            return window.innerHeight;
        }
    }

    private raycastNdc(ndc: Vector2, contextLayerAllowed: boolean = false) {
        this.rayCaster.setFromCamera(ndc, this.getCurrentCamera());
        const objects = contextLayerAllowed ? [this.tile2dFaceRenderedCube, ...this.contextLayerParentFront.children] : [this.tile2dFaceRenderedCube];
        return this.rayCaster.intersectObjects(objects);
    }

    private vertexShader() {
        return `
          varying vec2 v_uv;
    
          void main() {
            v_uv = uv; 
      
            vec4 modelViewPosition = modelViewMatrix * vec4(position, 1.0);
            gl_Position = projectionMatrix * modelViewPosition; 
          }
        `
    }
      
    private fragmentShader() {
        const textureAccessCode = (isRgb: boolean) => range(0, MAXIMUM_SUPPORTED_LOD).map(lod => `${lod == 0 ? "" : "else " }if (lod == ${lod}) {
                    ${isRgb ? "colormapped_rgba" : "datavalue"} = (texture(${TILES_TEXTURE_NAME}${lod}, uv_within_ttv)).${isRgb ? "rgba" : "r"};
                } `).join("");
        
        const shader = `
        precision highp float; 
        precision highp int; 
    
        varying vec2 v_uv;

        ${range(0, MAXIMUM_SUPPORTED_LOD).map(i => `uniform highp sampler2D ${TILES_TEXTURE_NAME}${i};`).join("\n")}
        
        const float TILE_SIZE = ${TILE_SIZE_2D}.0;
        const float FLOAT_NAN_REPLACEMENT_VALUE = ${FLOAT_NAN_REPLACEMENT_VALUE}.0;
        const float FLOAT_NOT_LOADED_REPLACEMENT_VALUE = ${FLOAT_NOT_LOADED_REPLACEMENT_VALUE}.0;
        const float RGB_NOT_LOADED_ALPHA_VALUE = ${RGB_NOT_LOADED_ALPHA_VALUE}.0;
        const float RGB_NAN_ALPHA_VALUE = ${RGB_NAN_ALPHA_VALUE}.0;
        
        uniform vec2 totalSize; // the whole thing, even offscreen stuff
    
        uniform vec2 displaySize; // what is being displayed on the cube, subset of the whole thing
        uniform vec2 displayOffset;
    
        uniform float lightStrength;

        uniform float colormapLowerBound;
        uniform float colormapUpperBound;
        uniform bool colormapFlipped;
        uniform bool hideData;
        uniform bool overflowX;
        uniform bool overflowY;
        uniform sampler2D colormap;

        uniform bool equalAreaCorrectX;
        uniform bool equalAreaCorrectY;

        uniform bool formatIsRgb;

        uniform bool gpsPositionEnabled;
        uniform vec2 gpsPositionRelativeCoordinates; // relative within current totalSize
    
        uniform int lod;

        uniform vec2[${MAXIMUM_SUPPORTED_LOD + 1}] tileSizesFromTtvs;
        uniform vec2[${MAXIMUM_SUPPORTED_LOD + 1}] tileOffsetsFromTtvs;

        vec2 positiveModTotalSize(vec2 v) {
            if (overflowX && overflowY) {
                return mod(v + totalSize, totalSize);
            } else if (overflowX) {
                return vec2(mod(v.x + totalSize.x, totalSize.x), v.y);
            } else if (overflowY) {
                return vec2(v.x, mod(v.y + totalSize.y, totalSize.y));
            }
            return v;
        }

        vec2 positiveMod1(vec2 v) {
            if (overflowX && overflowY) {
                return mod(mod(v, 1.0) + vec2(1.0), 1.0);
            } else if (overflowX) {
                return vec2(mod(mod(v.x, 1.0) + 1.0, 1.0), v.y);
            } else if (overflowY) {
                return vec2(v.x, mod(mod(v.y, 1.0) + 1.0, 1.0));
            }
            return v;
        }

        float easeOut(float x) {
            return 1.0 - pow(1.0 - x, 1.5);
        }

        vec3 getGpsPositionColor(float x) {
            vec3 blue = vec3(0.0 / 255.0, 40.0 / 255.0, 68.0 / 255.0);
            vec3 white = vec3(1.0);
            return mix(blue, white, step(0.8, x));
        }

        // 
        float lambert_cylindrical_equal_area(float yEA) {
            float val = 1.0 - 2.0 * yEA;
            float angle = asin(val);
            return 0.5 - angle / 3.14159265358979323846;
        }

        void main() {
            vec2 display_uv = clamp(positiveMod1(v_uv * displaySize / totalSize + displayOffset / totalSize), vec2(0.0), totalSize - vec2(1.0)); 

            float tile_size_adjusted = TILE_SIZE * pow(2.0, float(lod));
            vec2 total_tiles = totalSize * pow(0.5, float(lod)) / TILE_SIZE;
            vec2 total_tiles_whole = ceil(total_tiles);

            vec2 unclamped_pixel = displayOffset + clamp(v_uv, vec2(0.00001), vec2(0.99999)) * displaySize; // prevent pixel bleeding artifacts at edges
            vec2 minimum = mix(displayOffset, vec2(0.0), vec2(float(unclamped_pixel.x < displayOffset.x), float(unclamped_pixel.y < displayOffset.y)));
            vec2 maximum = displayOffset + displaySize; // exclusive bound, already next non-visible pixel at this coordinate

            vec2 clamp_border = vec2(0.01); // vec2(0.5) definitely removes all artifacts, vec2(0.01) also seems to remove all artifacts
            vec2 pixel = clamp(unclamped_pixel, minimum + clamp_border, maximum - clamp_border); // prevent pixel bleeding artifacts at edges

            if (equalAreaCorrectX) {
                pixel.x = lambert_cylindrical_equal_area(pixel.x / totalSize.x) * totalSize.x; 
                display_uv.x = lambert_cylindrical_equal_area(display_uv.x);
            }
            if (equalAreaCorrectY) {
                pixel.y = lambert_cylindrical_equal_area(pixel.y / totalSize.y) * totalSize.y; 
                display_uv.y = lambert_cylindrical_equal_area(display_uv.y);
            }

            float overflowSkipOffset = tile_size_adjusted - mod(totalSize.x, tile_size_adjusted);
            bool overflownTtv = tileOffsetsFromTtvs[lod].x + tileSizesFromTtvs[lod].x - overflowSkipOffset > totalSize.x;
            bool overflownDisplay = displayOffset.x + displaySize.x > totalSize.x;
            
            if (overflowX && pixel.x >= totalSize.x && overflownTtv) { 
                pixel.x += overflowSkipOffset; // push ahead to skip the "overflow" part of overflow tiles 
            } 

            // CASE 2 - ttv in small-positive domain, display/pixel in overflow domain
            if (overflowX && !overflownTtv && pixel.x >= totalSize.x) {
                pixel.x += -totalSize.x; // push back into small-positive domain
            }
            
            // CASE 3 - ttv in overflow domain, display/pixel in small-positive domain -> push display into overflow domain, minus the overflow part
            if (overflowX && overflownTtv && !overflownDisplay && pixel.x < tileOffsetsFromTtvs[lod].x) {
                pixel.x += totalSize.x + overflowSkipOffset; // push ahead to reach the overflow part of overflow tiles
            }

            vec2 uv_within_ttv = (pixel - tileOffsetsFromTtvs[lod]) / tileSizesFromTtvs[lod];
            bool is_in_ttv = uv_within_ttv.x >= 0.0 && uv_within_ttv.x <= 1.0 && uv_within_ttv.y >= 0.0 && uv_within_ttv.y <= 1.0;

            vec2 selected_tile = clamp(floor(pixel / tile_size_adjusted), vec2(0.0), total_tiles_whole - vec2(1.0));
            // float selected_tile_index = selected_tile.x + selected_tile.y * total_tiles_whole.x;

            vec2 local_tile_uv = (pixel - selected_tile * tile_size_adjusted) / tile_size_adjusted;

            vec3 colormapped = vec3(0.0);

            float isCheckerboard = 0.0;
            vec3 checkerboardColor = vec3(float(int(floor(10.0 * (local_tile_uv.x)) + floor(10.0 * (local_tile_uv.y))) % 2) * 0.2 + 0.4);
            float isNan = 0.0;
            vec3 nanColor = vec3(0.2);

            if (formatIsRgb) {
                vec4 colormapped_rgba = vec4(0.0);
                ${textureAccessCode(true)} // sets colormapped_rgba

                colormapped = colormapped_rgba.rgb;

                isCheckerboard = float(colormapped_rgba.a == RGB_NOT_LOADED_ALPHA_VALUE || hideData || !is_in_ttv);
                isNan = float(colormapped_rgba.a == RGB_NAN_ALPHA_VALUE);
            } else {
                float datavalue = 0.0;
                ${textureAccessCode(false)} // sets datavalue
                
                float p = clamp((datavalue - colormapLowerBound) / (colormapUpperBound - colormapLowerBound), 0.0, 1.0);
                p = mix(p, 1.0 - p, float(colormapFlipped));
                colormapped = texture(colormap, vec2(p, 0.0)).rgb;

                isCheckerboard = float(datavalue == FLOAT_NOT_LOADED_REPLACEMENT_VALUE || hideData || !is_in_ttv);
                isNan = float(datavalue == FLOAT_NAN_REPLACEMENT_VALUE);
            }
            colormapped = mix(mix(colormapped, nanColor, isNan), checkerboardColor, isCheckerboard);

            if (gpsPositionEnabled) {
                vec2 gpsPointSize = (${window.innerWidth > 900 ? 0.03 : 0.06} * displaySize) / totalSize; 
                float d = max(0.0, 1.0 - length(abs(display_uv - gpsPositionRelativeCoordinates) / gpsPointSize));
                vec4 addedGpsPositionColor = mix(vec4(0.0), vec4(d * getGpsPositionColor(d), d), float(gpsPositionEnabled));
                colormapped = addedGpsPositionColor.rgb + mix(colormapped, vec3(0.0), easeOut(addedGpsPositionColor.a));
            }

            gl_FragColor = vec4(colormapped + vec3(lightStrength), 1.0);
            // gl_FragColor *= float(is_in_ttv) * 0.5 + 0.5;
        }
    `
    
        return shader;
    }

    updateCameras(widthOverride: number = 0, heightOverride: number = 0) {
        const w = widthOverride > 0 ? widthOverride : this.getWidth();
        const h = heightOverride > 0 ? heightOverride : this.getHeight();
        if (this.getCurrentCamera() instanceof OrthographicCamera) {
            const aspect = w / h;
            let frustumWidth = this.orthographicCameraFrustumSize * aspect;
            let frustumHeight = this.orthographicCameraFrustumSize;
            if (this.context.singleFaceMode) {
                frustumWidth = 1;
                frustumHeight = 1;
            }
            const c = this.getCurrentCamera() as OrthographicCamera;
            c.left = frustumWidth / - 2;
            c.right = frustumWidth / 2;
            c.top = frustumHeight / 2;
            c.bottom = frustumHeight / - 2;
            c.updateProjectionMatrix();
        } else {
           (this.getCurrentCamera() as any).aspect = w / h;
            this.getCurrentCamera().updateProjectionMatrix();
        }
    }

    onWindowResize() {
        if (this.printTemplateDownloading) {
            return;
        }
        this.updateCameras();
        this.renderer.setSize(this.getWidth(), this.getHeight());
        this.renderer.setPixelRatio(window.devicePixelRatio);
        this.context.interaction.updateLabelPositions();
        this.context.interaction.updateToolbarPosition();
        this.context.interaction.updateTimeSeriesChartPosition();
        this.requestRender(false);
    }

    private newCubeMaterial3D(isBlockBasedVolumeRenderingIntermediateCube: boolean = false, existingUniforms: any | null = null, depthPass: boolean = false, pickPass: boolean = false) {
        // Material
        const shader = getVolumeRenderShader(this.context.useHalfFloatsForTile3d);
        const uniforms = existingUniforms ?? UniformsUtils.clone(shader.uniforms);

        // Only initialize colormap when we created a fresh uniforms object.
        if (!existingUniforms) {
            uniforms['colormap'].value = new DataTexture(this.colormapData, this.colormapData.length / 4, 1, RGBAFormat);
            uniforms['cubeScale'].value = this.context.cubeScale;
        }

        const material = new ShaderMaterial({
            uniforms: uniforms,
            vertexShader: shader.vertexShader,
            fragmentShader: shader.fragmentShader,
            defines: depthPass ? { DEPTH_PASS: 1 } : (pickPass ? { PICK_PASS: 1 } : { COLOR_PASS: 1 }),
            glslVersion: GLSL3,
            transparent: true,
            // depthTest: false,
            // depthWrite: false,
            side: FrontSide // main pass needs backfaces; shadow pass should write nearest depth
        });

        // if (depthPass) {
        //     material.shadowSide = BackSide;
        // }

        return material;
    }

    setVolumeRenderingShaderUseQuantileOverAbsoluteThreshold(useQuantile: boolean) {
        this.tile3dVolumeRenderedCube.material.uniforms['useQuantileOverAbsoluteThreshold'].value = useQuantile;
        this.volumeRenderingUseQuantileOverAbsoluteThreshold = useQuantile;
        this.requestRender();
    }

    setVolumeRenderingShaderQuantileThreshold(newQuantile: number) {
        this.tile3dVolumeRenderedCube.material.uniforms['quantileThreshold'].value = newQuantile; // For ISO renderstyle
        this.volumeRenderingQuantileThreshold = newQuantile;
        this.requestRender();
    }

    setVolumeRenderingShaderAbsoluteThreshold(newThreshold: number) {
        this.tile3dVolumeRenderedCube.material.uniforms['absoluteThreshold'].value = newThreshold; // For ISO renderstyle
        this.volumeRenderingAbsoluteThreshold = newThreshold;
        this.requestRender();
    }

    setVolumeRenderingShaderRange(newMin: number | null, newMax: number | null) {
        if (newMin != null) {
            this.tile3dVolumeRenderedCube.material.uniforms['rangeLowerThreshold'].value = newMin;
            this.volumeRenderingRangeLowerThreshold = newMin;
        }
        if (newMax != null) {
            this.tile3dVolumeRenderedCube.material.uniforms['rangeUpperThreshold'].value = newMax;
            this.volumeRenderingRangeUpperThreshold = newMax;
        }
        this.requestRender();
    }

    private newCubeMaterial() {
        const newDummyData = () => {
            return new Float32Array(1);
        }
        const newDummyTexture = () => {
            const b = new DataTexture(newDummyData());
            b.type = FloatType;
            b.format = RedFormat;
            return b;
        }
        
        const uniforms = {
            lod: { value: 0 },
            tileSizesFromTtvs: { value: Array.from(Array(MAXIMUM_SUPPORTED_LOD + 1), () => new Vector2()) },
            tileOffsetsFromTtvs: { value: Array.from(Array(MAXIMUM_SUPPORTED_LOD + 1), () => new Vector2()) },
            displaySize: { value: new Vector2() },
            displayOffset: { value: new Vector2() },
            totalSize: { value: new Vector2() },
            lightStrength: { value: 0.0 },
            colormapLowerBound: { value: 0.0 },
            colormapUpperBound: { value: 0.0 },
            overflowX: { value: false },
            overflowY: { value: false },
            formatIsRgb: { value: false },
            colormapFlipped: { value: false },
            hideData: { value: true },
            colormap: { value: new DataTexture(this.colormapData, this.colormapData.length / 4, 1, RGBAFormat) },
            gpsPositionEnabled: { value: false },
            gpsPositionRelativeCoordinates: { value: new Vector2() }
        }

        for (let lod = 0; lod <= MAXIMUM_SUPPORTED_LOD; lod++) {
            (uniforms as any)[`${TILES_TEXTURE_NAME}${lod}`] = { value: newDummyTexture() };
        }

        return new ShaderMaterial( {
            uniforms: uniforms,
    
            vertexShader: this.vertexShader(),
            fragmentShader: this.fragmentShader()
        } );
    }

    updateGpsPosition(relativeLatitude: number, relativeLongitude: number) {
        this.tile2dFaceRenderedCube.material[0].uniforms["gpsPositionRelativeCoordinates"].value = new Vector2(relativeLongitude, relativeLatitude);
        this.tile2dFaceRenderedCube.material[0].uniforms["gpsPositionEnabled"].value = true;
        this.requestRender(false);
    }
    
    disableGpsPosition() {
        this.tile2dFaceRenderedCube.material[0].uniforms["gpsPositionEnabled"].value = false;
    }

    updateColormapOptions(newLowerBound: number, newUpperBound: number, flipped: boolean) {
        for (let face = 0; face < 6; face++) {
            this.tile2dFaceRenderedCube.material[face].uniforms["colormapLowerBound"].value = newLowerBound;
            this.tile2dFaceRenderedCube.material[face].uniforms["colormapUpperBound"].value = newUpperBound;
            this.tile2dFaceRenderedCube.material[face].uniforms["colormapFlipped"].value = flipped;
        }
        this.tile3dVolumeRenderedCube.material.uniforms["colormapLowerBound"].value = newLowerBound;
        this.tile3dVolumeRenderedCube.material.uniforms["colormapUpperBound"].value = newUpperBound;
        this.tile3dVolumeRenderedCube.material.uniforms["colormapFlipped"].value = flipped;
    }

    updateColormapTexture(newColormap: Uint8Array) {
        this.colormapData.set(newColormap);
        for (let face = 0; face < 6; face++) {
            this.tile2dFaceRenderedCube.material[face].uniforms["colormap"].value.needsUpdate = true;
        }
        this.tile3dVolumeRenderedCube.material.uniforms["colormap"].value.needsUpdate = true;
    }

    private inactivityTimerThreshold: number = 1000 * 60 * 2; // 2 minutes
    private inactivityTimer: number | null = null;


    private blockBasedRenderPassCurrent: number = 0;
    private blockBasedRenderLod: number = 0;

    private readonly blockBasedRenderTilesPerPassShape: Vector3 = new Vector3(1,1,1); // later: (2, 2, 2); 
    
    private blockBasedRenderPasses: MultiBlockRenderPass[] = [];

    private startBlockBasedVolumeRenderingIfNecessary() {
        console.log("#### Volume viz render update ");

        const viewOrSelectionOrLodChanged = true;

        if (!viewOrSelectionOrLodChanged) {
            console.log("#### Volume viz view render: no changes detected, not restarting block-based volume rendering.");
            return;   
        }
        console.log("#### Volume viz view render: RESTARTING with new set of render passes.");
        
        const visibleTiles = this.context.interaction.getVisibleTiles3d();
        const lightPositionInData = 
            this.renderWorldCoordinatesToDataCoordinates(this.frontLight.position.clone())
                .addScalar(0.5)
                .multiply(this.context.interaction.cubeSelection.getDisplaySizeVector3d())
                .add(this.context.interaction.cubeSelection.getDisplayOffsetVector3d());

        const lod = 0; // wip, smarter later

        const renderPasses = MultiBlockRenderPass.from(lod, visibleTiles, this.blockBasedRenderTilesPerPassShape, lightPositionInData);
        if (renderPasses.length > this.BLOCK_BASED_VOLUME_RENDER_MAX_RENDER_PASSES) {
            console.error("#### Volume viz view render: too many unique partitions for block-based volume rendering, aborting.");
            return;
        }
        this.blockBasedRenderPasses = renderPasses;
        this.blockBasedRenderLod = lod; 
        this.blockBasedRenderPassCurrent = 0;

        this.triggerDownloadsForNextBlockBasedVolumeRenderingPass();
    }

    private triggerDownloadsForNextBlockBasedVolumeRenderingPass() {
        if (this.blockBasedRenderPassCurrent >= this.blockBasedRenderPasses.length) {
            console.log("#### Volume viz view render: no more passes needed.");
            // all done
            return;
        }

        const currentPass = this.blockBasedRenderPasses[this.blockBasedRenderPassCurrent];
        const tilesRenderedInThisPass: Tile3D[] = currentPass.tiles;

        const m = this.tile3dVolumeRenderedCube.material;
        // m.uniforms["displaySize"]
        // currentPass.tileTextureView.updateUniforms({ offsets: this.tile3dSimpleVolumeRenderingCube.material.uniforms[`tileOffsetsFromTtvs`], sizes: this.tile3dSimpleVolumeRenderingCube.material.uniforms[`tileSizesFromTtvs`]})

        console.log("#### Volume viz view render: triggering tile downloads for pass ", this.blockBasedRenderPassCurrent + 1, " of ", this.blockBasedRenderPasses.length, " with ", tilesRenderedInThisPass.length, " tiles.");

        // trigger downloads & put float into storage - once full
        this.context.interaction.triggerTileDownloads3d(tilesRenderedInThisPass);
    }

    requestRender(hasDataOrDataSelectionChanged: boolean = true) {
        // this.context.log(`${performance.now()}: requestRender`);

        if (this.context.orchestrationMasterMode) {
            if (this.inactivityTimer) {
                clearTimeout(this.inactivityTimer);
            }
            this.inactivityTimer = window.setTimeout(() => {
                this.onInactivityTimeout();
            }, this.inactivityTimerThreshold);
        }
        
        this.renderRequested = true;
        if (hasDataOrDataSelectionChanged) {
            this.shadowRenderRequested = true;
        }
        if (this.context.interaction) {
            this.context.interaction.resetRenderedAfterAllTilesDownloaded();
        }
    }
    
    onInactivityTimeout() {
        this.inactivityTimer = null;
        this.context.interaction.selectInitialCube();
    }

    private animate() {
        if (this.maxRangeIndicators.updateAnimations(this.context.interaction, this.dimensionOverflow)) {
            this.renderRequested = true;
        }
    
        if (this.volumeRenderingEnabled && this.pending3dPick) {
            this.pending3dPick = false;
            this.pickRing3d.requestPickRender();
        }

        const pickResults = this.pickRing3d.poll();
        if (pickResults.length) {
            const latest = pickResults[pickResults.length - 1];
            this.receivePick3d(latest.x, latest.y, latest.z, latest.hit, latest.featureId);
        }

        if (this.renderRequested) {
            this.renderRequested = false;
            this.render();
        }

        requestAnimationFrame(this.animate.bind(this));
    }

    private receivePick3d(x: number, y: number, z: number, hit: boolean, featureId: number) {
        // this.context.log(`Received 3D pick at (${x}, ${y}, ${z}), hit: ${hit}, featureId: ${featureId}`);
        this.context.interaction.receivePick3d(new Vector3(x, y, z), hit, featureId);
        this.tile3dVolumeRenderedCube.material.uniforms["pickedPosition"].value.set(x, y, z);
        this.tile3dVolumeRenderedCube.material.uniforms["pickedPositionActive"].value = hit;
        this.tile3dVolumeRenderedCube.material.uniforms["pickedPositionFeatureId"].value = featureId; // todo: handle featureId 0
        this.renderRequested = true;
    }

    hidePick3d() {
        this.tile3dVolumeRenderedCube.material.uniforms["pickedPositionActive"].value = false;
        this.renderRequested = true;
    }

    getCurrentCamera() {
        if (this.printTemplateDownloading) {
            return this.printTemplateCamera;
        } else if (this.context.isometricMode) {
            return this.orthographicCamera;
        } else {
            return this.perspectiveCamera;
        }
    }

    private volumeRenderTarget!: WebGLArrayRenderTarget;
    private volumeRenderCamera!: OrthographicCamera;


    renderMultiBlockPassIfReady(justDownloadedTile: Tile3D) {
        const currentPass = this.blockBasedRenderPasses[this.blockBasedRenderPassCurrent];
        if (!currentPass.setTileFinishedDownloading(justDownloadedTile)) {
            // not part of current pass or not all tiles ready yet
            return;
        }
        console.log("#### Rendering block-based volume rendering pass ", this.blockBasedRenderPassCurrent + 1, " of ", this.blockBasedRenderPasses.length);

        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms[`${TILES_TEXTURE_NAME}0`].value.needsUpdate = true;

        // const clipBoundary = this.context.interaction.getClipBoundariesForTiles3d([justDownloadedTile])[0];

        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms[`minClipBoundary`].value.set(clipBoundary.xMin, clipBoundary.yMin, clipBoundary.zMin);
        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms[`maxClipBoundary`].value.set(clipBoundary.xMax, clipBoundary.yMax, clipBoundary.zMax);
        // console.log(`Set clip boundaries to min(${clipBoundary.xMin}, ${clipBoundary.yMin}, ${clipBoundary.zMin}) max(${clipBoundary.xMax}, ${clipBoundary.yMax}, ${clipBoundary.zMax})`);
        // // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms["totalSize"].value.set(TILE_SIZE_3D, TILE_SIZE_3D, TILE_SIZE_3D);
        // const lodFactor = 2 ** tile.lod;
        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms["displaySize"].value.set(TILE_SIZE_3D * lodFactor, TILE_SIZE_3D * lodFactor, TILE_SIZE_3D * lodFactor);
        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms["displayOffset"].value.set(0, 0, 0);
        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms["lod"].value = this.lod3d;
        
        const adjustCameraAndTextureSize = (!this.volumeRenderTarget); // TODO: later smarter flag to allow re-render on interaction


        let mainCameraNdcWidth = -1;
        let mainCameraNdcHeight = -1;
        let mainCameraNdcPosition = new Vector2(0, 0);

        if (adjustCameraAndTextureSize) { 

            this.volumeRenderCamera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 20);
            // Copy "viewpoint" from main scene camera, but disregard translation
            this.volumeRenderCamera.quaternion.copy(this.orthographicCamera.quaternion);
    
            const distance = 10; 
            const localZ = new Vector3(0, 0, 1); // Camera's local forward becomes world backward
            localZ.applyQuaternion(this.volumeRenderCamera.quaternion); // Rotate by camera orientation
            this.volumeRenderCamera.position.copy(localZ.multiplyScalar(distance)); // Place camera at distance
    
            this.volumeRenderCamera.updateMatrixWorld();
            this.volumeRenderCamera.updateProjectionMatrix();
    
            // Adjust left/right/top/bottom to match the ndc size of the intermediate cube
            const vertexCoordinates = this.tile3dVolumeRenderedCube.geometry.attributes.position;
            let volumeRenderCameraNdcMin = new Vector2(1, 1);
            let volumeRenderCameraNdcMax = new Vector2(-1, -1);
            let mainCameraNdcMin = new Vector2(1, 1);
            let mainCameraNdcMax = new Vector2(-1, -1);
            let mainCameraNdcZValues = [];
            for (let i = 0; i < vertexCoordinates.count; i += 1) {
                const worldX = vertexCoordinates.getX(i);
                const worldY = vertexCoordinates.getY(i);
                const worldZ = vertexCoordinates.getZ(i);
                const vertexWorld = new Vector3(worldX, worldY, worldZ);
                const ndcVolumeRenderCamera = vertexWorld.clone().project(this.volumeRenderCamera);
                volumeRenderCameraNdcMin.x = Math.min(volumeRenderCameraNdcMin.x, ndcVolumeRenderCamera.x);
                volumeRenderCameraNdcMax.x = Math.max(volumeRenderCameraNdcMax.x, ndcVolumeRenderCamera.x);
                volumeRenderCameraNdcMin.y = Math.min(volumeRenderCameraNdcMin.y, ndcVolumeRenderCamera.y);
                volumeRenderCameraNdcMax.y = Math.max(volumeRenderCameraNdcMax.y, ndcVolumeRenderCamera.y);
                const ndcMainCamera = vertexWorld.clone().project(this.orthographicCamera);
                mainCameraNdcMin.x = Math.min(mainCameraNdcMin.x, ndcMainCamera.x);
                mainCameraNdcMax.x = Math.max(mainCameraNdcMax.x, ndcMainCamera.x);
                mainCameraNdcMin.y = Math.min(mainCameraNdcMin.y, ndcMainCamera.y);
                mainCameraNdcMax.y = Math.max(mainCameraNdcMax.y, ndcMainCamera.y);
                mainCameraNdcZValues.push(ndcMainCamera.z);
            }
            this.volumeRenderCamera.left = volumeRenderCameraNdcMin.x;
            this.volumeRenderCamera.right = volumeRenderCameraNdcMax.x;
            this.volumeRenderCamera.top = volumeRenderCameraNdcMax.y;
            this.volumeRenderCamera.bottom = volumeRenderCameraNdcMin.y;
            this.volumeRenderCamera.updateProjectionMatrix();
            
            mainCameraNdcHeight = mainCameraNdcMax.y - mainCameraNdcMin.y;
            mainCameraNdcWidth = mainCameraNdcMax.x - mainCameraNdcMin.x;
            mainCameraNdcPosition = new Vector2(
                (mainCameraNdcMin.x + mainCameraNdcMax.x) / 2,
                (mainCameraNdcMin.y + mainCameraNdcMax.y) / 2
            );

            const meanNdcZ = mainCameraNdcZValues.reduce((a, b) => a + b, 0) / mainCameraNdcZValues.length;

            
            for (let billboard of this.blockBasedVolumeRenderingImposterBillboards) {
                if (billboard.userData.lod == justDownloadedTile.lod) {
                    const billboardDepth = meanNdcZ + billboard.userData.renderPass * 0.001; // first pass in front of second pass
                    const billboardMaterial = billboard.material as ShaderMaterial;
                    billboardMaterial.uniforms["ndcWidth"].value = mainCameraNdcWidth;
                    billboardMaterial.uniforms["ndcHeight"].value = mainCameraNdcHeight;
                    billboardMaterial.uniforms["ndcPosition"].value = mainCameraNdcPosition;
                    billboardMaterial.uniforms["ndcDepth"].value = billboardDepth;
                }
            }

            console.log(`Adjusted volume render camera to left=${this.volumeRenderCamera.left}, right=${this.volumeRenderCamera.right}, top=${this.volumeRenderCamera.top}, bottom=${this.volumeRenderCamera.bottom}`);
        }


        if (!this.volumeRenderTarget) {
            const depth = this.blockBasedRenderPasses.length;
            const width = Math.ceil(this.getWidth() * mainCameraNdcWidth);
            const height = Math.ceil(this.getHeight() * mainCameraNdcHeight);
            this.volumeRenderTarget = new WebGLArrayRenderTarget(width, height, depth, { // TODO: or write directly to texture array?
                minFilter: LinearFilter,
                magFilter: LinearFilter,
                format: RGBAFormat,
                type: UnsignedByteType,
                depthBuffer: false,
                stencilBuffer: false,
                generateMipmaps: false
            });
            this.volumeRenderTarget.texture.wrapS = ClampToEdgeWrapping;
            this.volumeRenderTarget.texture.wrapT = ClampToEdgeWrapping;
            this.volumeRenderTarget.texture.minFilter = LinearFilter;
            this.volumeRenderTarget.texture.magFilter = LinearFilter;
            this.volumeRenderTarget.texture.generateMipmaps = false;

            this.renderer.initRenderTarget(this.volumeRenderTarget);
            console.log(`Created volume render target`, this.volumeRenderTarget);
        }

        const previousClearColor = this.renderer.getClearColor(new Color());
        const previousClearAlpha = this.renderer.getClearAlpha();

        this.renderer.setRenderTarget(this.volumeRenderTarget, this.blockBasedRenderPassCurrent);
        this.renderer.setClearColor(new Color(0, 0, 0), 0);
        this.renderer.clearColor();

        // hide everything except for the simple volume rendering cube
        const visibilityMap = new Map<Object3D, boolean>();
        this.scene.children.forEach((child) => {
            visibilityMap.set(child, child.visible);
            child.visible = child === this.tile3dVolumeRenderedCube;
        });

        // print uniforms
        for (const uniformName in this.tile3dVolumeRenderedCube.material.uniforms) {
            const uniformValue = this.tile3dVolumeRenderedCube.material.uniforms[uniformName].value;
            console.log(`Volume render uniform ${uniformName}:`, uniformValue);
        }

        this.renderer.render(this.scene, this.volumeRenderCamera);

        // restore visibility
        this.scene.children.forEach((child) => {
            child.visible = visibilityMap.get(child) || false;
            if (child == this.tile3dVolumeRenderedCube) {
                child.visible = false;
            }
        });

        const subCubeImposterBillboard = this.blockBasedVolumeRenderingImposterBillboards.find((b) => {
            return b.userData.renderPass == this.blockBasedRenderPassCurrent && b.userData.lod == justDownloadedTile.lod;
        });

        if (!subCubeImposterBillboard) {
            console.error(`Could not find subCubeImposterBillboard for render pass ${this.blockBasedRenderPassCurrent} and lod ${justDownloadedTile.lod}`);
            return;
        }
        
        subCubeImposterBillboard.material.uniforms["viewTile"].value = this.volumeRenderTarget.texture; 
        subCubeImposterBillboard.material.uniforms["viewTile"].value.needsUpdate = true;
        subCubeImposterBillboard.material.uniforms["layer"].value = this.blockBasedRenderPassCurrent;
        console.log("viewTile texture set on imposter billboard material:", subCubeImposterBillboard.material.uniforms["viewTile"].value);
    
        // console.log(`Updated imposter billboard for render pass ${this.blockBasedRenderPassCurrent} and lod ${justDownloadedTile.lod} with rendered texture. - size: ${texture.image.width}x${texture.image.height} pixels.`);
        this.renderer.setRenderTarget(null);
        this.renderer.setClearColor(previousClearColor, previousClearAlpha); // todo: unify with rest of app

        this.blockBasedRenderPassCurrent += 1;
        console.log(`Completed block-based volume rendering pass ${this.blockBasedRenderPassCurrent} / ${this.blockBasedRenderPasses.length}.`);

        this.triggerDownloadsForNextBlockBasedVolumeRenderingPass();
    }

    requestPick3d(x: number, y: number) {
        this.pending3dPick = true;
        this.pending3dPickMousePosition.set(x, y);
    }

    private renderPickPass() {
        if (!this.volumeRenderingEnabled || this.tile3dVolumeRenderedCube.visible == false) {
            console.warn("Skipping pick pass because volume rendering is not enabled or the volume rendered cube is not visible.");
            return;
        }

        // render single pixel fragment into pick buffer
        // - pick frame buffer is already bound by caller
        const c = this.getCurrentCamera();
        c.setViewOffset(
            this.getWidth(), 
            this.getHeight(),
            this.pending3dPickMousePosition.x,
            this.pending3dPickMousePosition.y,
            1,
            1
        );
        // render only the cube with the pick material
        c.layers.set(this.cube3dPickRenderLayer); 
        this.scene.overrideMaterial = this.tile3dVolumeRenderedCubePickMaterial;
        this.renderer.render(this.scene, c);
        this.scene.overrideMaterial = null;
        c.layers.set(0);
        c.clearViewOffset();
    }

    private shadowRenderRequested: boolean = false;

    private render() {
        if (this.shadowRenderRequested && 
                this.tile3dVolumeRenderedCube.customDepthMaterial && 
                this.volumeRenderingEnabled && 
                this.tile3dVolumeRenderedCube.visible &&
                this.is3dLodMultiBlockRendered(this.lod3d) == false) 
        {
            this.renderer.shadowMap.needsUpdate = true;
            (this.tile3dVolumeRenderedCube.customDepthMaterial as ShaderMaterial).needsUpdate = true;
            this.frontLight.shadow.camera.updateProjectionMatrix();
            this.shadowRenderRequested = false;
        } 

        const lightDirWorld = new Vector3().subVectors(this.frontLight.position, this.frontLight.target.position).normalize();

        this.tile3dVolumeRenderedCube.material.uniforms["lightDepthMap"].value = this.frontLight.shadow.map?.texture;
        this.tile3dVolumeRenderedCube.material.uniforms["lightMatrix"].value = this.frontLight.shadow.matrix;
        this.tile3dVolumeRenderedCube.material.uniforms["lightDepthMapIsRgba"].value = this.frontLight.shadow.map?.texture.format === RGBAFormat;
        this.tile3dVolumeRenderedCube.material.uniforms["lightDirection"].value = lightDirWorld;

        // WIP: view-based lighting, probably needs more in-depth changes later
        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms["lightDepthMap"].value = this.frontLight.shadow.map?.texture;
        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms["lightMatrix"].value = this.frontLight.shadow.matrix;
        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms["lightDepthMapIsRgba"].value = this.frontLight.shadow.map?.texture.format === RGBAFormat;
        // this.tile3dBlockBasedVolumeRenderingIntermediateCube.material.uniforms["lightDirection"].value = lightDirWorld;

        // if (this.volumeRenderingEnabled) {
        //     this.tile3dSimpleVolumeRenderingCube.visible = this.is3dLodMultiBlockRendered(this.lod3d) == false;
        // }

        // this.statsPanel.begin();

        this.renderer.setRenderTarget(null);
        // this.renderer.clear(true, true, true);

        // // print uniforms
        // for (const uniformName in this.tile3dSimpleVolumeRenderingCube.material.uniforms) {
        //     const uniformValue = this.tile3dSimpleVolumeRenderingCube.material.uniforms[uniformName].value;
        //     console.log(`Volume render uniform ${uniformName}:`, uniformValue);
        // }
        
        this.renderer.render(this.scene, this.getCurrentCamera());
        
        // this.statsPanel.end();

        if (this.allTilesDownloaded) {
            this.allTilesDownloaded = false;
            this.context.interaction.setRenderedAfterAllTilesDownloaded();
        }
    }
    
    private createUvDebugTexture(width: number, height: number) {
        const size = width * height;
        const texture_data = new Uint8Array( 3 * size );
    
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x)
                const stride = index * 3;
        
                texture_data[stride]     = 255.0 * (x) / (width); // r
                texture_data[stride + 1] = 255.0 * (y) / (height); // g
                texture_data[stride + 2] = 0.0; // b
            }
        }
    
        const texture = new DataTexture( texture_data, width, height, RGBFormat );
        texture.flipY = true;
        return texture
    }
    
    private getVertexCoordinatesFromFace(face: CubeFace): Vector3[] {
        let pos = this.tile2dFaceRenderedCube.geometry.attributes.position;
        const resultArray = [];
        const offset = face * 4;
        for (let i = 0; i < 4; i++) {
            const vertexIndex = i + offset;
            const vertexLocal = new Vector3(pos.getX(vertexIndex), pos.getY(vertexIndex), pos.getZ(vertexIndex));
            const vertexGlobal = this.tile2dFaceRenderedCube.localToWorld(vertexLocal);
            resultArray.push(vertexGlobal);
            // if (this.renderDebugCubes && face == CubeFace.Left) {
            //     this.debugCubes[i].position.copy(vertexGlobal);
            // }
        }
        return resultArray;
    }

    private getEdgesFromFace(face: CubeFace) {
        if (face == CubeFace.Front) {
            let front = this.getVertexCoordinatesFromFace(CubeFace.Front);
            return [ 
                new Edge(front[0], front[1], Dimension.X),  new Edge(front[2], front[3], Dimension.X), 
                new Edge(front[0], front[2], Dimension.Y),   new Edge(front[1], front[3], Dimension.Y)  
            ];
        } else if (face == CubeFace.Back) {
            let back = this.getVertexCoordinatesFromFace(CubeFace.Back);
            return [ 
                new Edge(back[1], back[0], Dimension.X),    new Edge(back[3], back[2], Dimension.X), 
                new Edge(back[0], back[2], Dimension.Y),     new Edge(back[1], back[3], Dimension.Y)  
            ];
        } else if (face == CubeFace.Top) {
            let top = this.getVertexCoordinatesFromFace(CubeFace.Top);
            return [ 
                new Edge(top[3], top[1], Dimension.X),  new Edge(top[2], top[0], Dimension.X), 
                new Edge(top[0], top[1], Dimension.Z),       new Edge(top[2], top[3], Dimension.Z)  
            ];
        } else if (face == CubeFace.Bottom) {
            let bot = this.getVertexCoordinatesFromFace(CubeFace.Bottom);
            return [ 
                new Edge(bot[1], bot[3], Dimension.X),  new Edge(bot[0], bot[2], Dimension.X), 
                new Edge(bot[0], bot[1], Dimension.Z),       new Edge(bot[2], bot[3], Dimension.Z)  
            ];
        } else if (face == CubeFace.Left) {
            let left = this.getVertexCoordinatesFromFace(CubeFace.Left);
            return [ 
                new Edge(left[1], left[3], Dimension.Y), new Edge(left[0], left[2], Dimension.Y), 
                new Edge(left[0], left[1], Dimension.Z),     new Edge(left[2], left[3], Dimension.Z)  
            ];
        } else {
            let right = this.getVertexCoordinatesFromFace(CubeFace.Right);
            return [ 
                new Edge(right[1], right[3], Dimension.Y),   new Edge(right[0], right[2], Dimension.Y), 
                new Edge(right[1], right[0], Dimension.Z),       new Edge(right[3], right[2], Dimension.Z)  
            ];
        }     
    }

    private getEdgesFromDimension(dimension: Dimension) {
        if (dimension == Dimension.X) {
            let front = this.getVertexCoordinatesFromFace(CubeFace.Front);
            let back = this.getVertexCoordinatesFromFace(CubeFace.Back);
            return [
                new Edge(front[0], front[1], Dimension.X), 
                new Edge(front[2], front[3], Dimension.X), 
                new Edge(back[1], back[0], Dimension.X), 
                new Edge(back[3], back[2], Dimension.X)
            ]
        } else if (dimension == Dimension.Y) {
            let front = this.getVertexCoordinatesFromFace(CubeFace.Front);
            let back = this.getVertexCoordinatesFromFace(CubeFace.Back);
            return [
                new Edge(front[0], front[2], Dimension.Y),
                new Edge(front[1], front[3], Dimension.Y),
                new Edge(back[0], back[2], Dimension.Y),
                new Edge(back[1], back[3], Dimension.Y)
            ]
        } else { // dimension == Dimension.Time
            let left = this.getVertexCoordinatesFromFace(CubeFace.Left);
            let right = this.getVertexCoordinatesFromFace(CubeFace.Right);
            return [
                new Edge(left[0], left[1], Dimension.Z),
                new Edge(left[2], left[3], Dimension.Z),
                new Edge(right[0], right[1], Dimension.Z),
                new Edge(right[2], right[3], Dimension.Z)
            ]
        }
    }

    private calculateLabelScreenPosition(startPoint: Vector3, edge: Edge) {
        const minimumLabelDistanceInWindowPixels = 40;
        const labelDirection = edge.getDirection();
        const labelStartScreenPosition = this.getScreenCoordinatesFromWorldPosition(startPoint);
        const labelEndScreenPosition = this.getScreenCoordinatesFromWorldPosition(startPoint.clone().addScaledVector(labelDirection, 0.1));

        const directionScreen = new Vector2(labelEndScreenPosition.x - labelStartScreenPosition.x, labelEndScreenPosition.y - labelStartScreenPosition.y);
        directionScreen.setLength(Math.min(minimumLabelDistanceInWindowPixels, directionScreen.length()));
        const positionScreen = directionScreen.clone().add(new Vector2(labelStartScreenPosition.x, labelStartScreenPosition.y));
        const angle = directionScreen.angle() / Math.PI; // [0-2]
        return { angle, positionScreen }
    }

    getLabelPositions() {
        let allEdges: Edge[] = [];
        for (let face = 0; face < 6; face++) {
            if (this.faceVisibility[face]) {
                const e = this.getEdgesFromFace(face);
                allEdges.push(...e);
            }
        }

        const contourEdges: Edge[] = [];

        for (let e of allEdges) {
            let sharesP1With = 0;
            let sharesP2With = 0;
            for (let f of allEdges) {
                if (e != f) {
                    if (e.sharesP1With(f)) {
                        sharesP1With += 1;
                    }
                    if (e.sharesP2With(f)) {
                        sharesP2With += 1;
                    }
                }
            }
            if (sharesP1With == 1 || sharesP2With == 1) {
                contourEdges.push(e);
            }
        }

        let dimensionsToLabel = [...new Set(contourEdges.map(v => v.dimension))];

        const visibilityThreshold = 0.1; // 10% of all cube pixels need to part of a face depending on the to be labeled dimension for it to be visible

        dimensionsToLabel = dimensionsToLabel.filter(dimension => {
            let faces = getAddressedFacesOfDimension(dimension);
            let total = faces.map(v => this.getPercentualFaceVisibility(v)).reduce((u, v) => u + v);
            return total > visibilityThreshold;
        });

        let labelDirectionDimensions: Dimension[] = [0, 0, 0];

        for (let dimension of dimensionsToLabel) {
            const dominantFace = this.getVisuallyDominantFace();
   
            if (dimension == Dimension.X) {
                labelDirectionDimensions[dimension] = (dominantFace == CubeFace.Front || dominantFace == CubeFace.Back) ? Dimension.Y : Dimension.Z;
            } else if (dimension == Dimension.Y) {
                if (dominantFace == CubeFace.Top || dominantFace == CubeFace.Bottom) {
                    const chooseLon = Math.abs(Math.round((this.getCurrentCamera().rotation.z / Math.PI) * 2)) % 2 == 1;
                    labelDirectionDimensions[dimension] = chooseLon ? Dimension.X : Dimension.Z;
                } else {
                    labelDirectionDimensions[dimension] = (dominantFace == CubeFace.Front || dominantFace == CubeFace.Back) ? Dimension.X : Dimension.Z;
                }
            } else if (dimension == Dimension.Z) {
                labelDirectionDimensions[dimension] = (dominantFace == CubeFace.Left || dominantFace == CubeFace.Right) ? Dimension.Y : Dimension.X; 
            }
        }
        
        const blockedEdges: Edge[] = [];
        let foundEdge = false;
        const result: LabelPositionResult[] = [new LabelPositionResult(), new LabelPositionResult(), new LabelPositionResult()];
        for (let dimension of dimensionsToLabel) {
            const labelDirectionDimension = labelDirectionDimensions[dimension];

            
            const labelEdgesWorld = contourEdges.filter(e => e.dimension == dimension)!;
            labelEdgesWorld.sort((a, b) => this.getScreenCoordinatesFromWorldPosition(a.middle()).z - this.getScreenCoordinatesFromWorldPosition(b.middle()).z )
            if (this.lastLabelEdges[dimension] !== undefined) {
                const lastEdge = this.lastLabelEdges[dimension]!;
                if (lastEdge.equals(labelEdgesWorld[1])) {
                    labelEdgesWorld.reverse(); // prefer old label edge
                }
            }
            let minDirectionEdgeWorld: Edge, maxDirectionEdgeWorld: Edge, labelEdgeWorld: Edge;
            for (let i = 0; i < labelEdgesWorld.length; i++) {
                labelEdgeWorld = labelEdgesWorld[i];
                minDirectionEdgeWorld = this.getEdgesFromDimension(labelDirectionDimension).find(
                    (directionEdge) => directionEdge.p1.equals(labelEdgeWorld.p1) || directionEdge.p2.equals(labelEdgeWorld.p1)
                )!.clone();
                if (minDirectionEdgeWorld.p1.equals(labelEdgeWorld.p1)) {
                    minDirectionEdgeWorld.reverse();
                }
                maxDirectionEdgeWorld = this.getEdgesFromDimension(labelDirectionDimension).find(
                    (directionEdge) => directionEdge.p1.equals(labelEdgeWorld.p2) || directionEdge.p2.equals(labelEdgeWorld.p2)
                )!.clone();
                if (maxDirectionEdgeWorld.p1.equals(labelEdgeWorld.p2)) {
                    maxDirectionEdgeWorld.reverse();
                }
                const blocked = !!(blockedEdges.find((v) => v.isIdenticalLine(minDirectionEdgeWorld))) || !!(blockedEdges.find((v) => v.isIdenticalLine(maxDirectionEdgeWorld)));
                if (!blocked) {
                    foundEdge = true;
                    blockedEdges.push(minDirectionEdgeWorld);
                    blockedEdges.push(maxDirectionEdgeWorld);
                    this.lastLabelEdges[dimension] = labelEdgeWorld;
                    break;
                }
            }
            if (minDirectionEdgeWorld! === undefined || maxDirectionEdgeWorld! === undefined || labelEdgeWorld! === undefined || !foundEdge) {
                console.warn(`Did not find edge for labeling dimension ${dimension}`)
                return result;
            }

            const minInfo = this.calculateLabelScreenPosition(labelEdgeWorld.p1, minDirectionEdgeWorld);
            const maxInfo = this.calculateLabelScreenPosition(labelEdgeWorld.p2, maxDirectionEdgeWorld);
            const nameInfo = this.calculateLabelScreenPosition(new Vector3().lerpVectors(labelEdgeWorld.p1, labelEdgeWorld.p2, 0.5), maxDirectionEdgeWorld.lerpedWith(minDirectionEdgeWorld));

            result[dimension] =  { 
                visible: true,
                screenPositionMinLabel: minInfo.positionScreen,
                screenPositionMaxLabel: maxInfo.positionScreen,
                screenPositionNameLabel: nameInfo.positionScreen,
                angleMinLabel: minInfo.angle,
                angleMaxLabel: maxInfo.angle,
                angleNameLabel: nameInfo.angle
            };
        }
        return result;
    }
    
    private getScreenCoordinatesFromWorldPosition(worldPosition: Vector3): Vector3 {
        // this.camera.updateMatrixWorld(); // fixes jittering issue, but done in OrbitControls now instead
        let result = worldPosition.clone().project(this.getCurrentCamera());
        let widthHalf = this.getWidth() / 2;
        let heightHalf = this.getHeight() / 2;
        
        const result_x = (result.x * widthHalf) + widthHalf;
        const result_y = -(result.y * heightHalf) + heightHalf;

        // returns correct coordinates in body pixel space (i.e. DPI is already factored in, 1 pixel in body space is 1 or more display pixels)
        return new Vector3(result_x, result_y , result.z);
    }
    
    hideData() {
        for (let face = 0; face < 6; face++) {
            this.tile2dFaceRenderedCube.material[face].uniforms["hideData"].value = true;
        }
    }

    showDataForFace(face: CubeFace) {
        this.tile2dFaceRenderedCube.material[face].uniforms["hideData"].value = false;
    }

    private getVisuallyDominantFace() {
        const c = this.getCurrentCamera();
        const b = c.position.toArray().map(a => Math.abs(a));
        const max = Math.max(...b);
        if (max == Math.abs(c.position.x)) {
            return Math.sign(c.position.x) > 0 ? CubeFace.Front : CubeFace.Back;
        }
        if (max == Math.abs(c.position.y)) {
            return Math.sign(c.position.y) > 0 ? CubeFace.Top : CubeFace.Bottom;
        }
        return Math.sign(c.position.z) > 0 ? CubeFace.Left : CubeFace.Right;
    }

    private updateLod2dForFace(face: CubeFace, allowEarlyRefresh: boolean = true) {
        const onScreenPixels = this.getPixelAmountOfFace(face);
        this.faceCurrentPixels[face] = onScreenPixels;
    
        const cubeEdgeLength = this.displayQuality * Math.sqrt(onScreenPixels);
    
        const dataSize = this.context.interaction.cubeSelection.getDisplaySizeVector2d(face);
        const dataPixelAmount = dataSize.x * dataSize.y;
        const dataEdgeLength = Math.sqrt(dataPixelAmount);
        const edgeRatio = Math.log2(dataEdgeLength / cubeEdgeLength);
        let lod = clamp(Math.round(edgeRatio), 0, this.context.interaction.getMaxLod2d());

        if (lod != this.lods2d[face]) {
            this.context.log(`[${CubeFace[face]}] New lod level: ${lod} (previously ${this.lods2d[face]})`);
            const earlyRefresh = lod > this.lods2d[face] && this.lods2d[face] != INVALID_LOD_PLACEHOLDER;
            this.lods2d[face] = lod;
            if (earlyRefresh && allowEarlyRefresh) {
                this.revealLod2dForFace(face);
            }
        }
    }

    private getPixelAmountOfFace(face: CubeFace) {
        const verticesGlobal = this.getVertexCoordinatesFromFace(face);
        const verticesScreen = verticesGlobal.map((worldPosition) => this.getScreenCoordinatesFromWorldPosition(worldPosition));
        verticesScreen.forEach(p => p.setZ(0));
    
        const firstHalf = new Triangle(verticesScreen[0], verticesScreen[1], verticesScreen[2]);
        const secondHalf = new Triangle(verticesScreen[1], verticesScreen[2], verticesScreen[3]);
        const onScreenPixels = (firstHalf.getArea() + secondHalf.getArea()) * Math.pow(devicePixelRatio, 2);
        return onScreenPixels;
    }

    is3dLodMultiBlockRendered(lod3d: number) {
        // const totalSize = this.context.interaction.cubeDimensions.totalSize();
        // const tileSize = TILE_SIZE_3D * Math.pow(2, lod3d);
        // const maxEdgeTileSize = 2;
        // const lodThreshold = Math.log2(Math.max(totalSize.x, totalSize.y, totalSize.z) / (tileSize * maxEdgeTileSize));


        const multiBlockRendered = false;
        // console.log(`Will be multi-block rendered: ${multiBlockRendered}`);
        return multiBlockRendered;
    }

    private updateLod3d() {
        const verticesGlobal = [];
        for (let face = 0; face < 6; face++) {
            verticesGlobal.push(...this.getVertexCoordinatesFromFace(face));
        }
        
        const verticesScreen = verticesGlobal.map(this.getScreenCoordinatesFromWorldPosition, this);
        // get minimum and maximum XY values
        const minX = Math.min(...verticesScreen.map(v => v.x));
        const maxX = Math.max(...verticesScreen.map(v => v.x));
        const minY = Math.min(...verticesScreen.map(v => v.y));
        const maxY = Math.max(...verticesScreen.map(v => v.y));
        
        const onScreenPixels = (maxX - minX) * (maxY - minY);
        const cubeEdgeLength = Math.sqrt(onScreenPixels);
    
        const dataSize = this.context.interaction.cubeSelection.getDisplaySizeVector3d();

        const dataPixelAmount = dataSize.x * dataSize.y * dataSize.z;
        const dataEdgeLength = Math.pow(dataPixelAmount, 1/3);
        const preClampLod = Math.log2(dataEdgeLength / cubeEdgeLength); // maybe add offset here, to decrease hardware load
        const desiredLod = clamp(Math.round(preClampLod), 0, this.context.interaction.getMaxLod3d());

        let chosenLod = -1;
        for (let checkedLod = desiredLod; checkedLod <= this.context.interaction.getMaxLod3d(); checkedLod++) {
            if (this.possibleToRenderLod3d(checkedLod)) {
                chosenLod = checkedLod;
                break;
            }
        }

        if (chosenLod != this.lod3d) {
            const multiBlockRendered = this.is3dLodMultiBlockRendered(chosenLod);
            this.context.log(`############### [3D] New lod level: ${chosenLod} (previously ${this.lod3d}) - will be multi-block rendered: ${multiBlockRendered}`);
            this.context.interaction.showResolutionChangeInfo(chosenLod);
            
            if (!multiBlockRendered) {
                this.updateTileTextureView3D(chosenLod);

                // sanity check, should always be possible to render
                // if (!updatedTtvPossibleToRender) {
                //     console.error(`tileTextureView does not allow rendering at desiredLod ${chosenLod}`);
                //     return;
                // }
            }
            this.lod3d = chosenLod;
            
            // const earlyRefresh = desiredLod > this.lod3d;
            // if (earlyRefresh && allowEarlyRefresh) { // dont early refresh for 3d lod changes?
            //     this.revealLod3d();
            // }
        }
    }
    
    private updateVisibilityForFace(face: CubeFace) {
        // if (this.context.studioMode) {
        //     return this.faceVisibility[face] = face != CubeFace.Back;
        // }
        const camera = this.getCurrentCamera();
        
        let visible = 
            (face == CubeFace.Front  && camera.position.x >  0.5) ||
            (face == CubeFace.Back   && camera.position.x < -0.5) ||
            (face == CubeFace.Top    && camera.position.y >  0.5) ||
            (face == CubeFace.Bottom && camera.position.y < -0.5) ||
            (face == CubeFace.Left   && camera.position.z >  0.5) ||
            (face == CubeFace.Right  && camera.position.z < -0.5);
        
        if (this.context.singleFaceMode) {
            visible = this.context.singleFace == face;
        }

        if (this.faceVisibility[face] != visible) {
            this.context.log(`[${CubeFace[face]}] Visible: ${visible} (previously: ${this.faceVisibility[face]})`)
            this.faceVisibility[face] = visible;
            this.updateRegionBorderPositionAndResolution(); 
        }
    }


    updateVisibilityAndLodsDebounced(): void {
        if (this.debouncedVisibilityAndLodUpdateTimeoutHandler) {
            window.clearTimeout(this.debouncedVisibilityAndLodUpdateTimeoutHandler);
        }
        this.debouncedVisibilityAndLodUpdateTimeoutHandler = window.setTimeout(() => { 
            this.updateVisibilityAndLods();
            this.debouncedVisibilityAndLodUpdateTimeoutHandler = 0;
        }, 100);
    }

    updateVisibilityAndLods(triggerTileDownloads: boolean = true) {
        if (typeof this.context.interaction.cubeSelection === "undefined" || !this.context.interaction.fullyLoaded) {
            return;
        }
        if (this.volumeRenderingEnabled) {
            this.updateLod3d();
        }
        for (let face = 0; face < 6; face++) {
            this.updateVisibilityForFace(face);
            if (this.faceVisibility[face]) {
                this.updateLod2dForFace(face, triggerTileDownloads);
            }
        }
        
        this.volumeRenderingFloor.visible = this.volumeRenderingEnabled && !(this.getCurrentCamera().position.y < 0.0);

        if (triggerTileDownloads) {
            if (this.volumeRenderingEnabled) {
                if (this.is3dLodMultiBlockRendered(this.lod3d)) {
                    this.startBlockBasedVolumeRenderingIfNecessary();
                } else {
                    this.context.interaction.triggerTileDownloads3d();
                }
            } else {
                this.context.interaction.triggerTileDownloads2d(this.context.singleFaceMode ? this.context.singleFace : undefined);
            }
        }
    }

    startDownloadPrintTemplate() {
        if (this.printTemplateDownloading) {
            return;
        }
        this.set2dCubeLightingEnabled(false);
        this.context.interaction.showPrintTemplateLoader()
        this.context.log("Start downloading print template");
        this.renderer.setSize(2048, 2048);
        this.updateCameras(2048, 2048);
        this.renderer.setPixelRatio(1);

        this.printTemplateCurrentFace = -1;
        this.printTemplateDownloading = true;
        this.printTemplateResults = [];
        this.downloadScreenshotAsDataUrl(); // fixes issue on some devices that the first screenshot download fails
        this.processNextFaceForPrintTemplate();
    }


    async processNextFaceForPrintTemplate() {
        if (this.printTemplateCurrentFace !== -1) {
            this.printTemplateResults.push(this.downloadScreenshotAsDataUrl()); 
            this.context.log("Finished face", CubeFace[this.printTemplateCurrentFace], this.printTemplateResults[this.printTemplateResults.length - 1].length);
        }
        this.printTemplateCurrentFace += 1;
        if (this.printTemplateCurrentFace >= 6) {
            this.finishDownloadPrintTemplate();
            return;
        }
        this.context.interaction.applyCameraPreset(`Single Face (${CubeFace[this.printTemplateCurrentFace]})`, this.printTemplateCamera);
        this.updateVisibilityAndLods();
        await this.updateRegionBorderPositionAndResolution();
        this.requestRender(false);
    }

    private printTemplateJustDownloaded = false;

    async finishDownloadPrintTemplate() {
        this.printTemplateDownloading = false;
        this.printTemplateJustDownloaded = true;
        this.context.interaction.applyCameraPreset();
        this.onWindowResize();
        this.set2dCubeLightingEnabled();
        this.updateVisibilityAndLods();
        this.context.interaction.updateLabelPositions();
        this.requestRender(false);
        this.context.log("Reset camera & renderer, now generating print template", this.printTemplateResults.length);
        let svg = await this.context.interaction.getPrintTemplateSvg();
        this.context.log("Got svg template", svg.length, svg.substring(0, 100));
        for (let i = 0; i < 6; i++) {
            svg = svg.replace(`current/${CubeFace[i].toLowerCase()}.png`, this.printTemplateResults[i]);
        }
        this.context.interaction.showPrintTemplateResult(svg);
        this.printTemplateJustDownloaded = false;
    }
    
    private getFilterFunctionForScreenshotsAndRecordings(includeUi: boolean) {
        const includedClasses = includeUi ? this.htmlClassesOptionalForScreenshots.concat(this.htmlClassesAlwaysInScreenshots) : this.htmlClassesAlwaysInScreenshots;
        const positiveFilter = (node: HTMLElement) => {
            let visible = false;
            let current = node;
            while (current != null) {
                if (this.htmlClassesNeverInScreenshots.some((classname) => current.classList?.contains(classname))) {
                    return false;
                }
                if (includedClasses.some((classname) => current.classList?.contains(classname))) {
                    visible = true;
                    break;
                }
                current = current.parentElement!;
            }
            return node.tagName === "CANVAS" || visible;
        }
        return positiveFilter;
    }

    async downloadScreenshotFromUi(includeUi: boolean, filename: string = "", dpiscale: number = 1) {
        if (dpiscale != 1) {
            this.renderer.setPixelRatio(window.devicePixelRatio * dpiscale);
            this.render();
        }
        let dataUrl = "";
        const positiveFilter = this.getFilterFunctionForScreenshotsAndRecordings(includeUi);
        if (!this.screenshotFontEmbedCss) {
            this.screenshotFontEmbedCss = await getFontEmbedCSS(this.parent);
        }
        try {
            dataUrl = await toPng(this.parent, { 
                "filter": positiveFilter, 
                pixelRatio: window.devicePixelRatio * dpiscale, 
                style: { backgroundColor: "transparent" }, 
                fontEmbedCSS: this.screenshotFontEmbedCss
            });
        } catch (e) {
            console.error("Error during screenshot generation", e);
            return;
        }
        let a = document.createElement('a');
        a.href = dataUrl;
        a.download = filename || `${this.getDownloadFileName()}.png`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        if (dpiscale != 1) {
            this.renderer.setPixelRatio(window.devicePixelRatio);
            this.render();
        }
    }

    downloadScreenshotAsDataUrl() {
        return this.renderer.domElement.toDataURL("image/png"); // works only if this.renderer.render() was just called
    }
    
    revealLod2dForFace(face: CubeFace) {
        this.tile2dFaceRenderedCube.material[face].uniforms["lod"].value = this.lods2d[face];
        this.tile2dFaceRenderedCubeTileTextureViews[face][this.lods2d[face]].applyOffsetToShader();
        this.requestRender();
    }

    revealLod3d() {
        if (!this.volumeRenderingEnabled) {
            console.warn("Tried to reveal 3D LOD while volume rendering is disabled");
            return;
        }
        if (this.first3dLodReveal) {
            this.tile2dFaceRenderedCube.visible = false;
            this.tile3dVolumeRenderedCube.visible = true;
            this.first3dLodReveal = false;
        }
        if (this.playAnimationOnNext3dLodReveal) {
            this.context.interaction.setVolumeVizUiLoaderVisibility(false);
            this.startThresholdAnimation();
            this.playAnimationOnNext3dLodReveal = false;
        }
        this.context.interaction.hideResolutionChangeInfo();
        this.tile3dVolumeRenderedCubeTileTextureViews[this.lod3d].applyOffsetToShader();
        this.tile3dVolumeRenderedCube.material.uniforms["lod"].value = this.lod3d;
        this.requestRender();
    }

    private startThresholdAnimation() {
        const animationEnabled = true;

        const targetLengthMs = 2500;
        let startTime = 0;
        let timer = undefined as number | undefined;

        const range = this.context.interaction.getVolumeRenderingAbsoluteThresholdRange();
        if (this.context.interaction.getVolumeRenderingUseQuantileOverAbsoluteThreshold()) {
            // if user switched to quantile before animation started, skip it since calling setSign is not safe 
            return;
        }
        this.context.interaction.setVolumeRenderingThresholdSign(1);
        this.context.interaction.setVolumeRenderingAbsoluteThreshold(range.min);

        if (!animationEnabled) {
            return;
        }
        this.context.interaction.toggleThresholdSliderAnimations(false); // prevent slider from jumping around while animation is playing

        const mean = this.context.tileData.observedMeanValue;
        const target = lerp(0.7 * (range.max - range.min) + range.min, mean, 0.5);

        const initialParameterId = this.context.interaction.selectedParameterId;
        const initialCubeId = this.context.interaction.selectedCube.id;
        const shouldStopAnimation = () => {
            return !this.volumeRenderingEnabled || 
                this.context.interaction.selectedParameterId != initialParameterId ||
                this.context.interaction.selectedCube.id != initialCubeId;
        }

        timer = window.setInterval(() => {
            if (shouldStopAnimation()) {
                if (timer) {
                    window.clearInterval(timer);
                    this.context.interaction.toggleThresholdSliderAnimations(true);
                }
            }
            if (startTime == 0) {
                startTime = performance.now();
            }
            const progress = clamp((performance.now() - startTime) / targetLengthMs, 0, 1);
            // const easedProgress = 1.0 - Math.pow(1.0 - progress, 3);
            const easedProgress = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2; // easeInOutQuad
            const t = lerp(range.min, target, easedProgress);
            this.context.interaction.setVolumeRenderingAbsoluteThreshold(t);
            if (progress >= 1) {
                if (timer) {
                    window.clearInterval(timer);
                    this.context.interaction.toggleThresholdSliderAnimations(true);
                }
            }
        }, 35);
    }

    setActivePolygonFeatureMap(array: Uint32Array, width: number, height: number, bounds: { minX: number, maxX: number, minY: number, maxY: number }) {
        if (!this.context.interaction.cubeDimensions.isGeospatialContextValid()) {
            this.context.log("Tried to set active polygon feature map, but geospatial context is not valid");
            return;
        }
        this.context.log("Setting active polygon feature map with size", width, height, "and bounds", bounds);

        let texture = this.tile3dVolumeRenderedCube.material.uniforms["polygonFeatureMap"].value as DataTexture | null;
        if (!texture || texture.image.width != width || texture.image.height != height) {
            if (texture) {
                texture.dispose();
            }
            texture = new DataTexture(array, width, height, RedIntegerFormat, UnsignedIntType);
            // texture.flipY = true;
            texture.needsUpdate = true;
            this.tile3dVolumeRenderedCube.material.uniforms["polygonFeatureMap"].value = texture;
        } else {
            texture.image.data = array;
            texture.needsUpdate = true;
        }

        // bounds in geo units, shader needs them in UV coordinates, so convert them
        const xGeospatialTotalRange = this.context.interaction.cubeDimensions.getGeospatialTotalRangeX();
        const yGeospatialTotalRange = this.context.interaction.cubeDimensions.getGeospatialTotalRangeY();

        const minUvX = (bounds.minX - xGeospatialTotalRange.getFirst()) / (xGeospatialTotalRange.getLast() - xGeospatialTotalRange.getFirst());
        const maxUvX = (bounds.maxX - xGeospatialTotalRange.getFirst()) / (xGeospatialTotalRange.getLast() - xGeospatialTotalRange.getFirst());
        const minUvY = (bounds.minY - yGeospatialTotalRange.getFirst()) / (yGeospatialTotalRange.getLast() - yGeospatialTotalRange.getFirst());
        const maxUvY = (bounds.maxY - yGeospatialTotalRange.getFirst()) / (yGeospatialTotalRange.getLast() - yGeospatialTotalRange.getFirst());

        this.context.log("Converted bounds to UV coordinates", { minUvX, maxUvX, minUvY, maxUvY });
        this.tile3dVolumeRenderedCube.material.uniforms["polygonFeatureMapBoundsMin"].value.set(minUvX, minUvY);
        this.tile3dVolumeRenderedCube.material.uniforms["polygonFeatureMapBoundsMax"].value.set(maxUvX, maxUvY);
    }

    getCurrentlyShownLodForFace(face: CubeFace) {
        return this.tile2dFaceRenderedCube.material[face].uniforms["lod"].value;
    }
    
    setAllTilesDownloaded() {
        this.context.log("   --  All tiles downloaded");
        this.allTilesDownloaded = true;
    }

    updateOverflowSettings(overflowX: boolean, overflowY: boolean, overflowZ: boolean, allowWidgetUpdate: boolean = true) {
        this.dimensionOverflow = [overflowX, overflowY, overflowZ];
        if (this.volumeRenderingEnabled) {
            this.dimensionOverflow = [false, false, false];
        }
        for (let face = 0; face < 6; face++) {
            this.tile2dFaceRenderedCube.material[face].uniforms["overflowX"].value = this.getOverflowForFace(face).x;
            this.tile2dFaceRenderedCube.material[face].uniforms["overflowY"].value = this.getOverflowForFace(face).y;
        }
        this.tile3dVolumeRenderedCube.material.uniforms["overflowX"].value = overflowX;
        this.tile3dVolumeRenderedCube.material.uniforms["overflowY"].value = overflowY;
        this.tile3dVolumeRenderedCube.material.uniforms["overflowZ"].value = overflowZ;
        
        if (this.context.widgetMode && allowWidgetUpdate) {
            this.updateWidgetModelDimensionWrapSettings(overflowX, overflowY, overflowZ)
        }
    }

    private getDownloadFileName(affix: string = "") {
        const cubeName = this.context.interaction.selectedCube.id !== "default" ? `${this.context.interaction.selectedCube.id}-` : "";
        const parameterName = this.context.interaction.selectedParameterId !== "default_var" ? `${this.context.interaction.selectedParameterId}-` : "";
        return `lexcube-${affix}${cubeName}${parameterName}${new Date().toLocaleDateString()}-${new Date().toLocaleTimeString()}`;
    }

    startRecordingAnimation(fps: number) {
        try {
            this.context.log("Start recording animation");
            const canvas = this.renderer.domElement;
            const Recorder = this.recordingFileFormat == RecordingFileFormat.GIF ? FixedFrameGifCanvasRecorder : FixedFrameVideoEncoderCanvasRecorder;
            this.canvasRecorder = new Recorder(this.parent, canvas, this.getFilterFunctionForScreenshotsAndRecordings(true), this.recordingFileFormat!, fps);
            this.canvasRecorder.startCapture(this.context.log.bind(this.context), this.getDownloadFileName("animation-"));
            this.recordingAnimation = true;
        } catch (e: unknown) {
            window.alert("Your browser does not support recording videos. Please try a different browser.");
            console.error("Error when starting animation recording", e);
        }
    }
    
    async stopRecordingAnimation() {
        if (!this.recordingAnimation) {
            this.context.interaction.resetAnimationRecordingUiPostDownload(); // just in case
            return;
        }
        this.recordingAnimation = false;
        await this.canvasRecorder?.requestFinishCapture(() => {
                this.context.interaction.resetAnimationRecordingUiPostDownload();
            }
        );
    }

    async captureRecordingFrame(lastFrame: boolean = false) {
        if (this.recordingAnimation) {
            await this.canvasRecorder?.recordFrame(lastFrame);
        }
    }

    setAnimationRecordingFormat(value: string) {
        this.recordingFileFormat = RecordingFileFormat[value as keyof typeof RecordingFileFormat];
    }
    
    adjustCameraPresetToCube(position: Vector3) {
        const c = this.getCurrentCamera();
        if (c instanceof OrthographicCamera) {
            return;
        }

        // c.updateMatrixWorld();
        const realMaxCanvasSize = Math.min(this.getWidth(), this.getHeight() + 300); // height is less important for UI etc.
        const extraPaddingForSmallCanvas = lerp(0.2, 0, (realMaxCanvasSize - 400) / 600); // 400px = +0.2, 700px = +0.1, 1000px = +0.0
        const paddingWorldUnits = 0.1 + Math.max(0, extraPaddingForSmallCanvas); // in world units
        const halfSize = 0.5 + paddingWorldUnits;

        const corners = [
            new Vector3(-halfSize, -halfSize, -halfSize),
            new Vector3(-halfSize, -halfSize, halfSize),
            new Vector3(-halfSize, halfSize, -halfSize),
            new Vector3(-halfSize, halfSize, halfSize),
            new Vector3(halfSize, -halfSize, -halfSize),
            new Vector3(halfSize, -halfSize, halfSize),
            new Vector3(halfSize, halfSize, -halfSize),
            new Vector3(halfSize, halfSize, halfSize)
        ];

        // Convert FOV to radians
        const fovRad = c.fov * (Math.PI / 180);
        const halfFovRad = fovRad / 2;
        const cameraDirection = new Vector3().copy(position).normalize();
        
        // Calculate the required distance for each corner
        let maxDistance = 0;
        
        for (const corner of corners) {
            const projectionLength = corner.dot(cameraDirection);
            
            const perpendicularVector = corner.clone().sub(cameraDirection.clone().multiplyScalar(projectionLength));
            const perpendicularDistance = perpendicularVector.length();
            
            let verticalDistance = perpendicularDistance / Math.tan(halfFovRad);
            let horizontalDistance = perpendicularDistance / (Math.tan(halfFovRad) * c.aspect);
            const cornerDistance = Math.max(verticalDistance, horizontalDistance);
            const totalDistance = cornerDistance + projectionLength;

            maxDistance = Math.max(maxDistance, totalDistance);
        }
        
        position.setLength(maxDistance);
    }
    
    setWidgetSize(width: number, height: number) {
        this.parent.style.width = `${width}px`;
        this.parent.style.height = `${height}px`;
        this.widgetModeWidth = width;
        this.widgetModeHeight = height;
        this.onWindowResize();
    }
    
    setDataType(dataType: DataType) {
        for (let i = 0; i < 6; i++) {
            this.tile2dFaceRenderedCube.material[i].uniforms["formatIsRgb"].value = (dataType == DataType.RGB);
        }
    }

    setVolumeRenderStyle(renderStyle: number) {
        this.tile3dVolumeRenderedCube.material.uniforms["renderstyle"].value = renderStyle;
        this.volumeRenderingRenderStyle = renderStyle;
        this.requestRender();
    }

    getVolumeRenderingShaderThresholdSign() {
        return this.volumeRenderingThresholdSign;
    }

    getVolumeRenderingAbsoluteThreshold() {
        return this.volumeRenderingAbsoluteThreshold;
    }

    getVolumeRenderingQuantileThreshold() {
        return this.volumeRenderingQuantileThreshold;
    }

    getVolumeRenderingUseQuantileOverAbsoluteThreshold() {
        return this.volumeRenderingUseQuantileOverAbsoluteThreshold;
    }

    setVolumeRenderingShaderThresholdSign(thresholdSign: number) {
        this.tile3dVolumeRenderedCube.material.uniforms["thresholdSign"].value = thresholdSign;
        this.volumeRenderingThresholdSign = thresholdSign;
        this.requestRender();
    }

    isWindowPositionOverCube(windowPosition: Vector2) {
        const x = (windowPosition.x / this.getWidth()) * 2 - 1;
        const y = -(windowPosition.y / this.getHeight()) * 2 + 1;
        // Build a picking ray from NDC
        const ray = new Ray();
        const raycaster = new Raycaster();
        raycaster.setFromCamera(new Vector2(x, y), this.getCurrentCamera());
        ray.copy(raycaster.ray); // origin, direction (normalized)

        // Unit cube AABB at the origin
        const boxMin = new Vector3(-0.5, -0.5, -0.5); // assumes unit cube
        const boxMax = new Vector3( 0.5,  0.5,  0.5);

        // Ray–AABB slab intersection (t in [0, +inf))
        const invDir = new Vector3(
            1 / ray.direction.x,
            1 / ray.direction.y,
            1 / ray.direction.z
        );

        let tmin = 0;               // start on the ray
        let tmax = Infinity;        // no far cap

        // For each axis, compute intersection interval and clip
        for (let i = 0; i < 3; i++) {
            const origin = (i === 0) ? ray.origin.x : (i === 1) ? ray.origin.y : ray.origin.z;
            const invD   = (i === 0) ? invDir.x     : (i === 1) ? invDir.y     : invDir.z;
            const minB   = (i === 0) ? boxMin.x     : (i === 1) ? boxMin.y     : boxMin.z;
            const maxB   = (i === 0) ? boxMax.x     : (i === 1) ? boxMax.y     : boxMax.z;

            let t1 = (minB - origin) * invD;
            let t2 = (maxB - origin) * invD;
            // Ensure t1 <= t2
            if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }

            tmin = Math.max(tmin, t1);
            tmax = Math.min(tmax, t2);
            if (tmax < tmin) return false; // disjoint
        }

        // If the nearest intersection is in front of the ray origin, we have a hit
        return tmax >= tmin && tmax >= 0;
    }
    
    addTimeSeriesMarker(timeSeriesId: number, face: CubeFace, nearestValidX: number, nearestValidY: number, color: string) {
        if (!this.pinModel) {
            console.warn("Pin model not loaded yet, cannot add time series marker");
            return;
        }
        const markerParent = new Object3D();
        markerParent.position.set(0, -nearestValidY, -nearestValidX);
        
        const markerMesh = this.pinModel.clone();
        markerMesh.material = this.contextLayerMarkerMaterial.clone();
        markerMesh.material.color = new Color(color); 

        markerParent.add(markerMesh);
        this.context.log("Adding time series marker at", markerParent.position);
        this.contextLayerParentFront.add(markerParent);
        markerParent.userData = { timeSeriesId, isTimeSeriesMarker: true, isContextLayerObject: true };
        return markerParent;
    }
    
    removeTimeSeriesMarker(marker: Object3D) {
        this.contextLayerParentFront.remove(marker);
        marker.traverse((child) => {
            if ((child as Mesh).geometry) {
                (child as Mesh).geometry.dispose();
            }
        });
    }


    createTileTextureViews() {
        const targetTextureSize = Math.min(4096, this.maxTextureSize2D); // cap to have high initial responsiveness, at the cost of potentially more TTV updates later

        this.tile2dFaceRenderedCubeTileTextureViews = [];
        for (let face = 0; face < 6; face++) {
            this.tile2dFaceRenderedCubeTileTextureViews[face] = [];
            for (let lod = 0; lod <= this.context.interaction.getMaxLod2d(); lod++) {
                this.tile2dFaceRenderedCubeTileTextureViews[face].push(new TileTextureView2D(face, lod, targetTextureSize, this.context.interaction.cubeDimensions.tiles2dForFace(face, lod), this.tile2dFaceRenderedCube.material[face].uniforms["tileOffsetsFromTtvs"], this.tile2dFaceRenderedCube.material[face].uniforms["tileSizesFromTtvs"]));
            }
        }
        this.context.log("created tileTextureViews2d", this.tile2dFaceRenderedCubeTileTextureViews);

        this.tile3dVolumeRenderedCubeTileTextureViews = [];
        for (let lod = 0; lod <= this.context.interaction.getMaxLod3d(); lod++) {
            this.tile3dVolumeRenderedCubeTileTextureViews.push(TileTextureView3D.createWithDynamicSize(lod, this.context.interaction.cubeDimensions.total3dTiles(lod), this.context.interaction.cubeDimensions.totalSize(), { offsets: this.tile3dVolumeRenderedCube.material.uniforms["tileOffsetsFromTtvs"], sizes: this.tile3dVolumeRenderedCube.material.uniforms["tileSizesFromTtvs"] }));
        }
    }

    private lastVisibleTiles2dHashed: string = "";
    private lastVisibleTiles3dHashed: string = "";

    visibleTiles2dChanged(visibleTiles: Tile2D[]) {
        const visibleTilesHashed = visibleTiles.map(t => t.getHashKey()).sort().join(",");
        if (visibleTilesHashed === this.lastVisibleTiles2dHashed) {
            return;
        }
        this.lastVisibleTiles2dHashed = visibleTilesHashed;
        this.updateTileTextureView2dFromVisibleTiles(visibleTiles);
    }

    visibleTiles3dChanged(visibleTiles: Tile3D[]) {
        const visibleTilesHashed = visibleTiles.map(t => t.getHashKey()).sort().join(",");
        if (visibleTilesHashed === this.lastVisibleTiles3dHashed) {
            return;
        }
        this.lastVisibleTiles3dHashed = visibleTilesHashed;
        this.updateTileTextureView3dFromVisibleTiles(visibleTiles);
    }

    updateTileTextureView3dFromVisibleTiles(visibleTiles: Tile3D[]) {
        if (visibleTiles.length === 0) {
            return;
        }
        const lod = visibleTiles[0].lod;
        const ttv = this.tile3dVolumeRenderedCubeTileTextureViews[lod];
        if (!ttv) {
            console.warn("Missing TileTextureView3D for lod", lod);
            return;
        }

        const ttvCoversAll = visibleTiles.every(t => ttv.containsTile(t))
        if (!ttvCoversAll || ttv.needsInitialUpdate()) {
            this.updateTileTextureView3D(lod);
        }
    }

    updateTileTextureView2dFromVisibleTiles(visibleTiles: Tile2D[]) {
        for (let face = 0; face < 6; face++) {
            const faceTiles = visibleTiles.filter(t => t.face == face);
            if (faceTiles.length == 0) {
                continue;
            }
            const lod = faceTiles[0].lod;
            const ttv = this.tile2dFaceRenderedCubeTileTextureViews[face][lod];
            if (!ttv) {
                console.warn("Missing TileTextureView2D for face/lod", face, lod);
                continue;
            }

            const ttvCoversAll = faceTiles.every(t => ttv.containsTile(t))
            if (!ttvCoversAll || ttv.needsInitialUpdate()) {
                this.updateTileTextureView2d(face, lod);
            }
        }
    }

    private updateTileTextureView2d(face: CubeFace, lod: number) {
        const updateResult = this.tile2dFaceRenderedCubeTileTextureViews[face][lod].updateOffset(this.context.interaction.cubeSelection, this.dimensionOverflow);
        if (updateResult.changed && !updateResult.firstOffsetUpdate) {
            this.context.log("TileTextureView2d for face", CubeFace[face], " lod", lod, "is updating: ", updateResult);
            this.context.tileData.moveTileStorageDataAfterTileTextureView2dUpdate(face, lod, updateResult);
            this.context.tileData.resetTileDownloadMapsAfterTileTextureView2dUpdate(face, lod, updateResult.previousOffset);
        }
    }

    possibleToRenderLod3d(lod: number) {    
        const ttv = this.tile3dVolumeRenderedCubeTileTextureViews[lod];
        if (!ttv) {
            return false;
        }
        return ttv.possibleToRender(this.context.interaction.cubeSelection.getDisplaySizeVector3d());
    }

    private updateTileTextureView3D(lod: number) {
        const updateResult = this.tile3dVolumeRenderedCubeTileTextureViews[lod].updateOffset(this.context.interaction.cubeSelection, this.dimensionOverflow);
        if (updateResult.changed && !updateResult.firstOffsetUpdate) {
            this.context.tileData.moveTileStorageDataAfterTileTextureView3dUpdate(lod, updateResult);
            this.context.tileData.resetTileDownloadMapsAfterTileTextureView3dUpdate(lod, updateResult.previousOffset);
            // this.context.tileData.resetTile3dDownloadMapsForLod(lod); // not necessary as it will be overwritten
        }
    }

    
    getTileTextureView2dTextureAccessParameters(tile: Tile2D, pixelX: number = 0, pixelY: number = 0): { startIndex: number; indexIncrementPerRow: number; tileInTtv: boolean } {
        if (!this.tileContainedInTileTextureView2d(tile) || (pixelX < 0 || pixelX >= TILE_SIZE_2D) || (pixelY < 0 || pixelY >= TILE_SIZE_2D)) {
            return { startIndex: -1, indexIncrementPerRow: -1, tileInTtv: false };
        }
        const ttvSizeInTiles = this.getTileTextureView2dSizeInTiles(tile.face, tile.lod);

        const localTileCoords = this.tile2dFaceRenderedCubeTileTextureViews[tile.face][tile.lod].getTilePositionInView(tile);
        const indexIncrementPerRow = ttvSizeInTiles.x * TILE_SIZE_2D;
        const startIndex = localTileCoords.x * TILE_SIZE_2D + localTileCoords.y * indexIncrementPerRow * TILE_SIZE_2D + pixelY * indexIncrementPerRow + pixelX;
        
        return { startIndex: startIndex, indexIncrementPerRow: indexIncrementPerRow, tileInTtv: true };
    }

    getTileTextureView3dTextureAccessParameters(tile: Tile3D, pixelX: number = 0, pixelY: number = 0, pixelZ: number = 0): { startIndex: number; indexIncrementPerRow: number; indexIncrementPerSlice: number; tileInTtv: boolean } {
        if (!this.tileContainedInTileTextureView3d(tile) || (pixelX < 0 || pixelX >= TILE_SIZE_2D) || (pixelY < 0 || pixelY >= TILE_SIZE_2D)) {
            return { startIndex: -1, indexIncrementPerRow: -1, indexIncrementPerSlice: -1, tileInTtv: false };
        }
        const ttvSizeInTiles = this.getTileTextureView3dSize(tile.lod);

        const indexIncrementPerPixelRow = ttvSizeInTiles.x * TILE_SIZE_3D;
        const indexIncrementPerPixelSlice = ttvSizeInTiles.y * indexIncrementPerPixelRow * TILE_SIZE_3D;

        const localTileCoords = this.tile3dVolumeRenderedCubeTileTextureViews[tile.lod].getTilePositionInView(tile);
        const startIndex = 
            localTileCoords.z * indexIncrementPerPixelSlice * TILE_SIZE_3D + 
            localTileCoords.y * indexIncrementPerPixelRow * TILE_SIZE_3D + 
            localTileCoords.x * TILE_SIZE_3D + 
            pixelZ * indexIncrementPerPixelSlice + 
            pixelY * indexIncrementPerPixelRow + 
            pixelX;
        
        return { startIndex: startIndex, indexIncrementPerRow: indexIncrementPerPixelRow, indexIncrementPerSlice: indexIncrementPerPixelSlice, tileInTtv: true };
    }

    getTileTextureView2dSizeInTiles(face: number, lod: number) {
        const ttv = this.tile2dFaceRenderedCubeTileTextureViews[face][lod];
        return ttv ? ttv.getSizeInTiles() : new Vector2(0, 0);
    }

    getTileTextureView2dOffsetInTiles(face: number, lod: number) {
        const ttv = this.tile2dFaceRenderedCubeTileTextureViews[face][lod];
        return ttv ? ttv.getOffsetInTiles() : new Vector2(0, 0);
    }

    getTileTextureView3dSize(lod: number) {
        if (this.is3dLodMultiBlockRendered(lod) && this.blockBasedRenderPasses.length > 0) {
            return this.blockBasedRenderPasses[this.blockBasedRenderPassCurrent].tileTextureView.getSizeInTiles();
        }
        const ttv = this.tile3dVolumeRenderedCubeTileTextureViews[lod];
        return ttv ? ttv.getSizeInTiles() : new Vector3(0, 0, 0);
    }

    tileContainedInTileTextureView2d(tile: Tile2D, offsetOverride?: Vector2) {
        const ttv = this.tile2dFaceRenderedCubeTileTextureViews[tile.face][tile.lod];
        return ttv ? ttv.containsTile(tile, offsetOverride) : false;
    }

    tileContainedInTileTextureView3d(tile: Tile3D, offsetOverride?: Vector3) {
        const ttv = this.tile3dVolumeRenderedCubeTileTextureViews[tile.lod];
        return ttv ? ttv.containsTile(tile, offsetOverride) : false;
    }

    getTileTextureView3dOffset(lod: number) {
        const ttv = this.tile3dVolumeRenderedCubeTileTextureViews[lod];
        return ttv.getOffsetInTiles();
    }

    getOverflowForFace(face: CubeFace) {
        return { x: this.dimensionOverflow[face < 4 ? 0 : 1], y: this.dimensionOverflow[face < 2 ? 1 : 2] };
    }
}


export { CubeRendering }
