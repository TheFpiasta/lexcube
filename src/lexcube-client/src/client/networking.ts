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

import { io, Socket } from 'socket.io-client';
import { Vector2 } from 'three';
import { CubeClientContext } from './client';
import { Tile2D, Tile3D } from './tiledata';
import { PACKAGE_VERSION, TILE_TYPE_2D, TILE_TYPE_3D, TileRequestIntention } from './constants';

class Networking {
    private receivedBytes = 0;
    private apiServerUrl: string;
    private useMetaDataCache: boolean = false;
    private context: CubeClientContext;
    private tileWebsocket!: Socket;
    private orchestratorChannel!: BroadcastChannel;
    private connectionLostAlerted: boolean = false;

    private tileCache: Map<string, any>;
    private eventCache: Map<string, any>;
    private memoryEnabled: boolean = true;

    constructor(context: CubeClientContext, apiServerUrl: string) {
        this.context = context;
        this.apiServerUrl = apiServerUrl;
        this.tileCache = new Map<string, any>();
        this.eventCache = new Map<string, any>();
    }

    connect() {
        if (this.context.widgetMode) {
            return;
        }
        this.connectTileWebsockets();
        if (this.context.orchestrationMinionMode || this.context.orchestrationMasterMode) {
            this.connectOrchestratorChannel();
        }
    }

    postStartup() {
        if (this.context.widgetMode) {
            this.widgetVersionCheck();
            return;
        }
    }

    connectTileWebsockets() {
        this.tileWebsocket = io(this.apiServerUrl, { path: "/ws/socket.io/", transports: ["websocket"], reconnection: true, reconnectionDelay: 5000 });
        this.tileWebsocket.on('connect', this.onConnectTileWebsockets.bind(this));
        this.tileWebsocket.on('disconnect', this.onDisconnectTileWebsockets.bind(this));
        this.tileWebsocket.on('tile_data', this.onTileWebsocketMessage.bind(this));
        this.tileWebsocket.on('event_data', this.onEventDataWebsocketMessage.bind(this));
        this.tileWebsocket.on('connect_error', (e: any) => { 
            console.error("Connect error (tile websockets)", e); 
            if (!this.connectionLostAlerted) {
                this.connectionLostAlerted = true;
                this.context.interaction.showConnectionLostAlert();
            }
        });
        return new Promise<void>(resolve => { this.tileWebsocket.on('connect', () => resolve() )})
    }
    
    connectOrchestratorChannel() {
        this.orchestratorChannel = new BroadcastChannel("orchestrating");
        this.orchestratorChannel.addEventListener('message', this.onOrchestratorChannelMessage.bind(this));
        this.orchestratorChannel.addEventListener('message_error', (e: Event) => { 
            console.error("Message parse error (orchestrator broadcast)", e);
        });
    }

    private onConnectTileWebsockets() {
        this.context.log("Connected to tile websockets")
        this.connectionLostAlerted = false;
        this.context.interaction.hideConnectionLostAlert();
        // this.context.tileData.resetTileStatistics();
    }

    private onDisconnectTileWebsockets() {
        this.context.log("Disconnected from tile websockets")
    }

    pushOrchestratorSelectionUpdate(displayOffsets: Vector2[], displaySizes: Vector2[], finalChange: boolean) {
        const mapVector2ToObject = (a: Vector2) => { return { x: a.x, y: a.y }; };
        this.orchestratorChannel.postMessage({
            type: "selection_changed",
            displayOffsets: displayOffsets.map(mapVector2ToObject),
            displaySizes: displaySizes.map(mapVector2ToObject),
            finalChange
        })
    }

    pushOrchestratorColormapOptionsUpdate(colormapMinValue: number, colormapMaxValue: number, colormapFlipped: boolean) {
        this.orchestratorChannel.postMessage({
            type: "colormap_options_changed",
            minValue: colormapMinValue,
            maxValue: colormapMaxValue,
            flipped: colormapFlipped
        });   
    }

    pushOrchestratorColormapNameUpdate(name: string) {
        this.orchestratorChannel.postMessage({
            type: "colormap_name_changed",
            name,
        });
    }
    
    pushOrchestratorParameterUpdate(parameter: string) {
        this.orchestratorChannel.postMessage({
            type: "parameter_changed",
            parameter
        });
    }

    pushOrchestratorCubeUpdate(cube: string) {
        this.orchestratorChannel.postMessage({
            type: "cube_changed",
            cube
        });
    }

    pushOrchestratorAnimationUpdate(animationRunning: boolean) {
        this.orchestratorChannel.postMessage({
            type: "animation_changed",
            animationRunning
        });
    }

    private onOrchestratorChannelMessage(message: any) {
        // console.log("Received orchestrator message of type", message.data.type)
        if (message.data.type == "selection_changed") {
            const mapObjectToVector2 = (a: {x: number, y: number}) => new Vector2(a.x, a.y);
            this.context.interaction.cubeSelection.applyVectorsFromOrchestrator(message.data.displayOffsets.map(mapObjectToVector2), message.data.displaySizes.map(mapObjectToVector2), message.data.finalChange);
        } 
        
        if (this.context.orchestrationMasterMode) {
            return; // Do not process messages from the orchestrator channel in master mode
        }

        if (message.data.type == "parameter_changed") {
            this.context.interaction.selectParameter(message.data.parameter);
        } else if (message.data.type == "cube_changed") {
            this.context.interaction.selectCubeById(message.data.cube);
        } else if (message.data.type == "animation_changed") {
            this.context.interaction.orchestratorAnimationRunning = message.data.animationRunning;
        } else if (message.data.type == "colormap_name_changed") {
            this.context.tileData.selectColormapByName(message.data.name);
        } else if (message.data.type == "colormap_options_changed") {
            this.context.tileData.colormapMaxValueOverride = message.data.maxValue;
            this.context.tileData.colormapMinValueOverride = message.data.minValue;
            this.context.tileData.colormapFlipped = message.data.flipped;
            this.context.tileData.colormapHasChanged(true, false);
        } else {
            console.warn("Unknown orchestrator message type:", message.data.type);
        }
    }


    private onTileWebsocketMessage(message: any) {
        this.onTileData(message, message.data as ArrayBuffer)
    }

    onTileData(header: any, buffer: ArrayBuffer) {
        const tileType = header.metadata.tileType;
        const is2d = tileType == TILE_TYPE_2D;
        const is3d = tileType == TILE_TYPE_3D;

        if (!is2d && !is3d) {
            console.error("Unknown tile type", tileType, "metadata:", header.metadata);
            return;
        }
        const intention = header.metadata.requestIntention as TileRequestIntention;
        const tiles = is2d ? Tile2D.fromResponseData(header.metadata) : Tile3D.fromResponseData(header.metadata);
        const sizes = header.dataSizes;
        let read = 0;
        this.receivedBytes += buffer.byteLength;
        for (let index = 0; index < tiles.length; index++) {
            const t = tiles[index];
            const size = sizes[index];
            const data = buffer.slice(read, read + size);
            this.tileCache.set(t.getHashKey(), data);
            read += size;
            this.context.tileData.receiveTile(t, data, intention);
        }
    }
    
    private onEventDataWebsocketMessage(message: any) {
        this.onEventData(message, message.data as ArrayBuffer)
    }
    
    onEventData(header: any, buffer: ArrayBuffer) {
        const metadata = header.metadata;
        this.eventCache.set(JSON.stringify(metadata), buffer);
        this.receivedBytes += buffer.byteLength;
        this.context.interaction.receiveEventData(metadata, buffer);
    }
    
    
    async downloadTiles(requestedTiles: (Tile2D | Tile3D)[], requestIntention: TileRequestIntention = TileRequestIntention.Visualization) {
        const is2d = requestedTiles[0] instanceof Tile2D;
        const is3d = requestedTiles[0] instanceof Tile3D;

        requestedTiles.forEach(t => this.context.tileData.setTileDownloadTriggered(t));
        
        let tilesToDownload: (Tile2D | Tile3D)[] = [];
        for (let t of requestedTiles) {
            const key = t.getHashKey();
            if (this.memoryEnabled && this.tileCache.has(key)) {
                this.context.tileData.receiveTile(t, this.tileCache.get(key), requestIntention);
                continue;
            } 
            tilesToDownload.push(t);
        }
        
        this.context.log(`Download multiple tiles (Downloading: ${tilesToDownload.length} - Cached: ${requestedTiles.length - tilesToDownload.length})`)
        if (tilesToDownload.length > 0) {
            const tileGroups = new Map<string, (Tile2D | Tile3D)[]>();
            tilesToDownload.forEach((t) => {
                const key = t.getRequestGroupKey();
                if (tileGroups.get(key)) {
                    tileGroups.get(key)?.push(t);
                } else {
                    tileGroups.set(key, [t]);
                }
            });

            let totalData: {}[] = [];
            if (is2d) {
                for (let group of tileGroups.values()) {
                    let xys: number[][] = [];
                    group.forEach((t) => xys.push([t.x, t.y]));
                    xys.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))
                    totalData.push(group[0].getRequestDataWithMultipleXYs(xys))
                }
            } else if (is3d) {
                for (let group of tileGroups.values()) {
                    let xyzs: number[][] = [];
                    group.forEach((t) => xyzs.push([t.x, t.y, (t as any).z]));
                    xyzs.sort((a, b) => (a[1] - b[1]) || (a[0] - b[0]))
                    totalData.push(group[0].getRequestDataWithMultipleXYs(xyzs))
                }
            }
            totalData.forEach((d: any) => d.requestIntention = requestIntention);
            this.requestTileData(totalData);
        }
    }

    
    async downloadEventData(datasetId: string, parameter: string, eventType: string) {
        const requestData = {
            datasetId,
            parameter,
            eventType,
        };
        console.log("Requesting event data with", requestData);
        if (this.eventCache.has(JSON.stringify(requestData))) {
            this.context.interaction.receiveEventData(requestData, this.eventCache.get(JSON.stringify(requestData)));
            return;
        }
        this.requestEventData(requestData);
    }

    requestTileDataFromWidget?: (data: any) => void;

    private requestTileData(data: any) {
        if (this.context.widgetMode) {
            this.requestTileDataFromWidget!({"request_type": "request_tile_data_multiple", "request_data": data});
        } else {
            this.tileWebsocket.emit('request_tile_data_multiple', data);
        }
    }
    
    private requestEventData(data: any) {
        if (this.context.widgetMode) {
            throw Error("Event data request not implemented in widget mode");
            //this.requestTileDataFromWidget!({"request_type": "request_event_data", "request_data": data});
        } else {
            this.tileWebsocket.emit('request_event_data', data);
        }
    }

    async widgetVersionCheck() {
        try {
            const f = await fetch("https://version.lexcube.org");
            const j = await f.json();
            const new_version = j["current_lexcube_jupyter_version"];
            if (new_version != PACKAGE_VERSION) {
                this.context.interaction.showVersionOutofDateWarning(new_version, PACKAGE_VERSION);
            }    
        } catch (error) {
            console.log("Could not fetch version information from version.lexcube.org");
        }
    }

    fetchMetadataFromWidget?: (url_path: string) => any;

    async fetch(url_path: string) {
        if (this.context.widgetMode) {
            const d = await this.fetchMetadataFromWidget!(url_path);
            return d;
        } else {
            return await this.fetchJson(url_path);
        }
    }

    async downloadDatasetSubset(datasetId: string, parameter: string, xMin: number, xMax: number, yMin: number, yMax: number, zMin: number, zMax: number) {
        if (this.context.widgetMode) {
            throw Error("Dataset subset download not implemented in widget mode");
        }
        // @app.get('/api/datasets/{dataset_id}/download/{parameter}/{zmin}/{zmax}/{ymin}/{ymax}/{xmin}/{xmax}')
        const url_path = `/api/datasets/${datasetId}/download/${parameter}/${zMin}/${zMax}/${yMin}/${yMax}/${xMin}/${xMax}`;
        const response = await this.fetchJson(url_path);
        if (response["success"] != true) { 
            throw Error(`Could not download dataset subset: ${response["message"]}`);
        }
        const taskId = response["task_id"];
        this.context.log("Started dataset subset download task with ID", taskId, response);

        let downloadReady = false;
        let statusUrl = `/api/downloads/${taskId}/status`;
        let retries = 0;
        const maxRetries = 600; // wait max 50 minutes
        while (!downloadReady && retries < maxRetries) {
            const statusResponse = await this.fetchJson(statusUrl);
            if (statusResponse["status"] == "failed") {
                throw Error(`Dataset subset download task failed: ${statusResponse["message"]}`);
            } else if (statusResponse["status"] == "completed") {
                downloadReady = true;
                this.context.log("Dataset subset download task completed", statusResponse);
            } else if (statusResponse["status"] == "in_progress") {
                await new Promise(resolve => setTimeout(resolve, 5000)); // wait 5 seconds before checking again
                retries += 1;
            } else {
                throw Error(`Unknown download task status: ${statusResponse}`);
            }
        }
        if (!downloadReady) {
            throw Error("Dataset subset download task timed out");
        }
        const downloadUrl = `${this.apiServerUrl}${response["file_url"]}`;
        // start download of the file without navigating away from the page
        this.context.log("Starting dataset subset download from", downloadUrl);
        window.open(downloadUrl, '_self');
    }
    
    private async fetchJson(url_path: string) {
        let full_url = `${this.apiServerUrl}${url_path}`
        let key = `cached_api_response-${url_path}`;
        let stored = localStorage.getItem(key);
        if (this.useMetaDataCache && stored) {
            this.context.log("USING CACHED API METADATA:", full_url);
            return JSON.parse(stored);
        }
        try {
            const response = await fetch(full_url);
            const json = await response.json() as any;
            if (this.useMetaDataCache) {
                localStorage.setItem(key, JSON.stringify(json));
            }
            return json;
        } catch (error) {
            console.error("Could not fetch from", full_url, error);
            throw Error(`Could not fetch from ${full_url}, ${error}`);
        }
    }

    getFetchUrl(endpoint: string): any {
        return `${this.apiServerUrl}${endpoint}`;
    }    

    setMemoryEnabled(enabled: boolean) {
        this.memoryEnabled = enabled;
        if (!enabled) {
            this.tileCache = new Map<string, any>();
        }
    }

    resetTileCache() {
        this.context.log("Resetting tile cache")
        this.tileCache = new Map<string, any>();
        this.eventCache = new Map<string, any>();
    }

}


export { Networking }