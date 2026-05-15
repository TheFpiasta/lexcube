import { AnimationAction, AnimationClip, AnimationMixer, BooleanKeyframeTrack, BoxGeometry, Clock, InterpolateSmooth, Mesh, MeshBasicMaterial, NumberKeyframeTrack, Object3D, Plane, Scene, Vector2, Vector3 } from 'three';
import { LoopOnce } from 'three';
import { CubeFace, Dimension } from '../constants';
import { CubeInteraction } from '../interaction';


class MaxRangeIndicatorManager {
    private scene: Scene;

    private maxRangeIndicatorClippingPlanes: Map<CubeFace, Plane> = new Map<CubeFace, Plane>();
    private maxRangeIndicatorParent!: Object3D;
    private maxRangeIndicatorParentPerFace = new Map<CubeFace, Object3D>();
    private maxRangeIndicatorMap = new Map<string, Object3D>();

    private maxRangeIndicatorAnimationMixers: AnimationMixer[] = [];
    private maxRangeIndicatorAnimationActions: AnimationAction[] = [];
    private maxRangeIndicatorAnimationsPlaying = false;

    private animationClock: Clock = new Clock();

    private requestRenderCallback: () => void;
    private cubeScale: Vector3;

    constructor(scene: Scene, requestRender: () => void, cubeScale: Vector3) {
        this.scene = scene;
        this.requestRenderCallback = requestRender;
        this.cubeScale = cubeScale;
    }

    create() {
        const color = 0xffffff;
        const indicatorWidth = 0.0075;
        const indicatorLength = this.cubeScale.clone().addScalar(indicatorWidth);
        const indicatorDistance = this.cubeScale.clone().multiplyScalar(0.5).addScalar(indicatorWidth / 2 + 0.0015); // some padding for clipping

        this.maxRangeIndicatorClippingPlanes.set(CubeFace.Front, new Plane(new Vector3(1, 0, 0), indicatorDistance.x));
        this.maxRangeIndicatorClippingPlanes.set(CubeFace.Back, new Plane(new Vector3(-1, 0, 0), indicatorDistance.x));
        this.maxRangeIndicatorClippingPlanes.set(CubeFace.Top, new Plane(new Vector3(0, 1, 0), indicatorDistance.y));
        this.maxRangeIndicatorClippingPlanes.set(CubeFace.Bottom, new Plane(new Vector3(0, -1, 0), indicatorDistance.y));
        this.maxRangeIndicatorClippingPlanes.set(CubeFace.Left, new Plane(new Vector3(0, 0, 1), indicatorDistance.z));
        this.maxRangeIndicatorClippingPlanes.set(CubeFace.Right, new Plane(new Vector3(0, 0, -1), indicatorDistance.z));

        const opacityAnimationTimePoints = [0, 0.8, 1.0]; // Time in seconds
        const opacityAnimationValues = [1.0, 0.3, 0]; // Opacity values at each time point
        const visibilityAnimationValues = [true, true, false]; // Visibility values at each time point

        this.maxRangeIndicatorParent = new Object3D();
        this.scene.add(this.maxRangeIndicatorParent);

        for (let face = 0; face < 6; face++) {
            const p = new Object3D();
            this.maxRangeIndicatorParent.add(p);
            this.maxRangeIndicatorParentPerFace.set(face, p);
        }

        // Define keyframes for opacity animation
        const opacityKF = new NumberKeyframeTrack('.material.opacity', opacityAnimationTimePoints, opacityAnimationValues, InterpolateSmooth);
        const visibleKF = new BooleanKeyframeTrack('.visible', opacityAnimationTimePoints, visibilityAnimationValues);

        // Create an animation clip
        const clip = new AnimationClip("flash-and-fade", -1, [opacityKF, visibleKF]);

        const makeMesh = (id: string, length: number) => {
            const boxGeometry = new BoxGeometry(indicatorWidth, length, indicatorWidth);
            const material = new MeshBasicMaterial({
                color: color,
                transparent: true,
                depthTest: false,
                clippingPlanes: Array.from(this.maxRangeIndicatorClippingPlanes.values()),
            });
            const mesh = new Mesh(boxGeometry, material);
            mesh.visible = false;

            // Set up an AnimationMixer and play the clip
            const mixer = new AnimationMixer(mesh);
            const action = mixer.clipAction(clip, mesh);
            action.setLoop(LoopOnce, 1);

            this.maxRangeIndicatorAnimationMixers.push(mixer);
            this.maxRangeIndicatorAnimationActions.push(action);

            mesh.userData.mixer = mixer;
            mesh.userData.action = action;
            mesh.userData.dimension = Dimension[id.split("-")[2].toUpperCase() as keyof typeof Dimension];

            const faceStr = id.split("-")[0];
            const face = CubeFace[faceStr.toUpperCase()[0] + faceStr.slice(1) as keyof typeof CubeFace];
            this.maxRangeIndicatorParentPerFace.get(face)!.add(mesh);
            this.maxRangeIndicatorMap.set(id, mesh);
            return mesh;
        }

        // Left to right, in default view
        const createIndicatorZ = (x: number, y: number, id: string) => {
            const mesh = makeMesh(id, indicatorLength.z);
            mesh.rotation.set(Math.PI / 2, 0, 0);
            mesh.position.set(x, y, 0);
        }

        // Down to up, in default view
        const createIndicatorY = (x: number, z: number, id: string) => {
            const mesh = makeMesh(id, indicatorLength.y);
            mesh.position.set(x, 0, z);
        }

        // Front to back, in default view
        const createIndicatorX = (y: number, z: number, id: string) => {
            const mesh = makeMesh(id, indicatorLength.x);
            mesh.position.set(0, y, z);
            mesh.rotation.set(0, 0, Math.PI / 2);
        }

        const o = this.cubeScale.clone().multiplyScalar(0.5);

        createIndicatorZ(o.x, o.y, "front-min-y");
        createIndicatorZ(o.x, -o.y, "front-max-y");
        createIndicatorZ(-o.x, o.y, "back-min-y");
        createIndicatorZ(-o.x, -o.y, "back-max-y");
                
        createIndicatorY(o.x, o.z, "left-max-y");
        createIndicatorY(o.x, -o.z, "right-max-y");
        createIndicatorY(-o.x, o.z, "left-min-y");
        createIndicatorY(-o.x, -o.z, "right-min-y");
        
        createIndicatorX(o.y, o.z, "top-min-x");
        createIndicatorX(o.y, -o.z, "top-max-x");
        createIndicatorX(-o.y, o.z, "bottom-min-x");
        createIndicatorX(-o.y, -o.z, "bottom-max-x");
        
        createIndicatorZ(o.x, o.y, "top-max-y");
        createIndicatorZ(o.x, -o.y, "bottom-max-y");
        createIndicatorZ(-o.x, o.y, "top-min-y");
        createIndicatorZ(-o.x, -o.y, "bottom-min-y");
                
        createIndicatorY(o.x, o.z, "front-min-x");
        createIndicatorY(o.x, -o.z, "front-max-x");
        createIndicatorY(-o.x, o.z, "back-min-x");
        createIndicatorY(-o.x, -o.z, "back-max-x");
        
        createIndicatorX(o.y, o.z, "left-min-x");
        createIndicatorX(o.y, -o.z, "right-min-x");
        createIndicatorX(-o.y, o.z, "left-max-x");
        createIndicatorX(-o.y, -o.z, "right-max-x");
    }

    updatePositionAndScale(interaction: CubeInteraction, dimensionOverflow: boolean[]) {
        for (let face = 0; face < 6; face++) {
            const faceParent = this.maxRangeIndicatorParentPerFace.get(face)!;
            const currentSize = interaction.cubeSelection.getDisplaySizeVector2d(face);
            const currentOffset = interaction.cubeSelection.getDisplayOffsetVector2d(face);

            const xParameterRange = interaction.cubeDimensions.xParameterRangeForFace(face);
            const yParameterRange = interaction.cubeDimensions.yParameterRangeForFace(face);

            const worldSize = new Vector2(xParameterRange.length(), yParameterRange.length());
            const worldOffset = new Vector2(xParameterRange.min, yParameterRange.min);
            const globalCenterPoint = worldSize.clone().divideScalar(2).add(worldOffset);
            const currentCenterPoint = currentSize.clone().divideScalar(2).add(currentOffset);

            const zoomRelativeToWorld = new Vector2().copy(worldSize).divide(currentSize);
            const cubeScale = this.cubeScale.clone();
            
            if (face == CubeFace.Front || face == CubeFace.Back) {
                // mapping: local x is global -z, local y is global -y
                faceParent.scale.set(1.0, zoomRelativeToWorld.y, zoomRelativeToWorld.x);
                faceParent.position.setY(cubeScale.y * zoomRelativeToWorld.y * (currentCenterPoint.y - globalCenterPoint.y) / worldSize.y);
                faceParent.position.setZ(cubeScale.z * zoomRelativeToWorld.x * (currentCenterPoint.x - globalCenterPoint.x) / worldSize.x);
                
                 for (let mesh of faceParent.children) {
                     if (mesh.userData.dimension == Dimension.X) {
                        mesh.scale.set(1.0, 1.0, 1.0 / zoomRelativeToWorld.x);
                     } else {
                        mesh.scale.set(1.0, dimensionOverflow[Dimension.X] ? 3.0 : 1.0, 1.0 / zoomRelativeToWorld.y);
                     }
                 }
            } else if (face == CubeFace.Top || face == CubeFace.Bottom) {
                // local x is global -z, local y is global +x!
                faceParent.scale.set(zoomRelativeToWorld.y, 1.0, zoomRelativeToWorld.x);
                faceParent.position.setX(cubeScale.x * -zoomRelativeToWorld.y * (currentCenterPoint.y - globalCenterPoint.y) / worldSize.y);
                faceParent.position.setZ(cubeScale.z * zoomRelativeToWorld.x * (currentCenterPoint.x - globalCenterPoint.x) / worldSize.x);
                
                for (let mesh of faceParent.children) {
                    if (mesh.userData.dimension == Dimension.X) {
                        mesh.scale.set(1.0, 1.0, 1.0 / zoomRelativeToWorld.x);
                    } else {
                        mesh.scale.set(1.0 / zoomRelativeToWorld.y, dimensionOverflow[Dimension.X] ? 3.0 : 1.0, 1.0);
                    }
                }
            } else {
                // local x is global -y, local y is global +x!
                faceParent.scale.set(zoomRelativeToWorld.y, zoomRelativeToWorld.x, 1.0);
                faceParent.position.setX(cubeScale.x * -zoomRelativeToWorld.y * (currentCenterPoint.y - globalCenterPoint.y) / worldSize.y);
                faceParent.position.setY(cubeScale.y * zoomRelativeToWorld.x * (currentCenterPoint.x - globalCenterPoint.x) / worldSize.x);
                
                for (let mesh of faceParent.children) {
                    if (mesh.userData.dimension == Dimension.X) {
                        mesh.scale.set(1.0 / zoomRelativeToWorld.x, 1.0, 1.0);
                    } else {
                        mesh.scale.set(1.0 / zoomRelativeToWorld.y, 1.0, 1.0);
                    }
                }
            }
        }
    }

    showAll() {
        for (let face = 0; face < 6; face++) {
            this.show(face, Dimension.X, true);
            this.show(face, Dimension.X, false);
            this.show(face, Dimension.Y, true);
            this.show(face, Dimension.Y, false);
        }
    }

    show(face: CubeFace, dimension: Dimension, min: boolean) {
        const id = `${CubeFace[face].toLowerCase()}-${min ? "min" : "max"}-${Dimension[dimension].toLowerCase()}`;
        const mesh = this.maxRangeIndicatorMap.get(id);
        if (mesh) {
            mesh.userData.activeFace = face;
            mesh.userData.action.reset();
            mesh.userData.action.play();
            this.maxRangeIndicatorAnimationsPlaying = true;
            this.requestRenderCallback();
        } else {
            console.error(`Max range indicator with id ${id} not found`);
        }
    }

    /**
     * Updates animations. Returns true if still animating.
     */
    updateAnimations(interaction: CubeInteraction, dimensionOverflow: boolean[]): boolean {
        if (!this.maxRangeIndicatorAnimationsPlaying) {
            return false;
        }
        const delta = this.animationClock.getDelta();
        for (let i = 0; i < this.maxRangeIndicatorAnimationMixers.length; i++) {
            this.maxRangeIndicatorAnimationMixers[i].update(delta);
        }
        this.maxRangeIndicatorAnimationsPlaying = this.maxRangeIndicatorAnimationActions.some((action) => {
            return action.isRunning();
        });
        this.updatePositionAndScale(interaction, dimensionOverflow);
        return true;
    }
}

export { MaxRangeIndicatorManager }
