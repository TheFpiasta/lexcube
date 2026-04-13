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
import { Tile } from './tiledata';
import { Dimension, PACKAGE_VERSION } from './constants';

class Networking {
    private receivedBytes = 0;
    private apiServerUrl: string;
    private useMetaDataCache: boolean = false;
    private context: CubeClientContext;
    private tileWebsocket!: Socket;
    private orchestratorChannel!: BroadcastChannel;
    private connectionLostAlerted: boolean = false;

    private tileCache: Map<string, any>;

    constructor(context: CubeClientContext, apiServerUrl: string) {
        this.context = context;
        this.apiServerUrl = apiServerUrl;
        this.tileCache = new Map<string, any>();
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
        this.tileWebsocket = io(this.apiServerUrl, {
            path: '/ws/socket.io/',
            transports: ['websocket'],
            reconnection: true,
            reconnectionDelay: 5000
        });
        this.tileWebsocket.on('connect', this.onConnectTileWebsockets.bind(this));
        this.tileWebsocket.on('disconnect', this.onDisconnectTileWebsockets.bind(this));
        this.tileWebsocket.on('tile_data', this.onTileWebsocketMessage.bind(this));
        this.tileWebsocket.on('tile_request_info', this.onTileRequestInfo.bind(this));
        this.tileWebsocket.on('connect_error', (e: any) => {
            console.error('Connect error (tile websockets)', e);
            if (!this.connectionLostAlerted) {
                this.connectionLostAlerted = true;
                this.context.interaction.showConnectionLostAlert();
            }
        });
        return new Promise<void>((resolve) => {
            this.tileWebsocket.on('connect', () => resolve());
        });
    }

    connectOrchestratorChannel() {
        this.orchestratorChannel = new BroadcastChannel('orchestrating');
        this.orchestratorChannel.addEventListener(
            'message',
            this.onOrchestratorChannelMessage.bind(this)
        );
        this.orchestratorChannel.addEventListener('message_error', (e: Event) => {
            console.error('Message parse error (orchestrator broadcast)', e);
        });
    }

    private onConnectTileWebsockets() {
        this.context.log('Connected to tile websockets');
        this.connectionLostAlerted = false;
        this.context.interaction.hideConnectionLostAlert();
        // this.context.tileData.resetTileStatistics();
    }

    private onDisconnectTileWebsockets() {
        this.context.log('Disconnected from tile websockets');
        this.context.tileData.resetTileStatistics();
    }

    pushOrchestratorSelectionUpdate(
        displayOffsets: Vector2[],
        displaySizes: Vector2[],
        finalChange: boolean
    ) {
        const mapVector2ToObject = (a: Vector2) => {
            return { x: a.x, y: a.y };
        };
        this.orchestratorChannel.postMessage({
            type: 'selection_changed',
            displayOffsets: displayOffsets.map(mapVector2ToObject),
            displaySizes: displaySizes.map(mapVector2ToObject),
            finalChange
        });
    }

    pushOrchestratorParameterUpdate(parameter: string) {
        this.orchestratorChannel.postMessage({
            type: 'parameter_changed',
            parameter
        });
    }

    pushOrchestratorCubeUpdate(cube: string) {
        this.orchestratorChannel.postMessage({
            type: 'cube_changed',
            cube
        });
    }

    private onOrchestratorChannelMessage(message: any) {
        // console.log("Received orchestrator message of type", message.data.type)
        if (message.data.type == 'selection_changed') {
            const mapObjectToVector2 = (a: { x: number; y: number }) => new Vector2(a.x, a.y);
            this.context.interaction.cubeSelection.applyVectorsFromOrchestrator(
                message.data.displayOffsets.map(mapObjectToVector2),
                message.data.displaySizes.map(mapObjectToVector2),
                message.data.finalChange
            );
        } else if (message.data.type == 'parameter_changed') {
            this.context.interaction.selectParameter(message.data.parameter);
        } else if (message.data.type == 'cube_changed') {
            this.context.interaction.selectCubeById(message.data.cube);
        }
    }

    private onTileWebsocketMessage(message: any) {
        this.onTileData(message, message.data as ArrayBuffer);
    }

    private onTileRequestInfo(message: any) {
        const requestId = message?.requestId;
        if (typeof requestId !== 'number') {
            return;
        }
        const tiles = this.requestTilesById.get(requestId);
        if (!tiles) {
            return;
        }
        if (message?.externalFetchRequired) {
            this.context.tileData.clearTilesForDownload(tiles);
        }
        this.requestTilesById.delete(requestId);
    }

    onTileData(header: any, buffer: ArrayBuffer) {
        const tiles = Tile.fromResponseData(header.metadata);
        const sizes = header.dataSizes;
        let read = 0;
        this.receivedBytes += buffer.byteLength;
        for (let index = 0; index < tiles.length; index++) {
            const t = tiles[index];
            const size = sizes[index];
            const data = buffer.slice(read, read + size);
            this.tileCache.set(t.getHashKey(), data);
            this.context.tileData.receiveTile(t, data);
            read += size;
        }
        const meta = header.metadata;
        if (!this.context.widgetMode && typeof meta?.requestId === 'number') {
            const blockKey = this.buildBlockKey(
                meta.datasetId,
                meta.parameter,
                meta.indexDimension,
                meta.indexValue
            );
            const pendingRequests = this.pendingRequestsByBlock.get(blockKey);
            if (pendingRequests) {
                pendingRequests.delete(meta.requestId);
                if (pendingRequests.size === 0) {
                    this.pendingRequestsByBlock.delete(blockKey);
                }
            }
            const requestedTiles = this.requestedTilesByBlock.get(blockKey);
            if (requestedTiles) {
                for (const tile of tiles) {
                    requestedTiles.delete(tile.getHashKey());
                }
                if (requestedTiles.size === 0) {
                    this.requestedTilesByBlock.delete(blockKey);
                }
            }
            this.requestTilesById.delete(meta.requestId);
        }
    }

    updateViewBlocks(visibleTiles: Tile[]) {
        if (this.context.widgetMode) {
            return;
        }
        const currentViewBlocks = new Set<string>();
        const viewBlockHints = new Map<
            string,
            {
                datasetId: string
                parameter: string
                indexDimension: string
                indexValue: number
                face: number
                lod: number
            }
        >();
        for (const t of visibleTiles) {
            const indexDimension = `by_${Dimension[t.indexDimension()].toLowerCase()}`;
            const blockKey = this.buildBlockKey(t.cubeId, t.parameter, indexDimension, t.indexValue);
            currentViewBlocks.add(blockKey);
            if (!viewBlockHints.has(blockKey)) {
                viewBlockHints.set(blockKey, {
                    datasetId: t.cubeId,
                    parameter: t.parameter,
                    indexDimension,
                    indexValue: t.indexValue,
                    face: t.face,
                    lod: t.lod
                });
            }
        }

        const blocksToCancel: any[] = [];
        const requestIdsToCancel = new Set<number>();
        for (const [blockKey, block] of this.pendingBlocks.entries()) {
            if (currentViewBlocks.has(blockKey)) {
                continue;
            }
            blocksToCancel.push(block);
            this.canceledBlocks.add(blockKey);
            const pendingRequests = this.pendingRequestsByBlock.get(blockKey);
            if (pendingRequests) {
                for (const requestId of pendingRequests.values()) {
                    requestIdsToCancel.add(requestId);
                }
            }
        }

        if (blocksToCancel.length > 0 || requestIdsToCancel.size > 0) {
            this.tileWebsocket.emit('cancel_tile_requests', {
                blocks: blocksToCancel,
                requestIds: Array.from(requestIdsToCancel.values())
            });

            for (const requestId of requestIdsToCancel.values()) {
                this.requestTilesById.delete(requestId);
            }

            for (const block of blocksToCancel) {
                const blockKey = this.buildBlockKey(
                    block.datasetId,
                    block.parameter,
                    block.indexDimension,
                    block.indexValue
                );
                const requestedTiles = this.requestedTilesByBlock.get(blockKey);
                if (requestedTiles && requestedTiles.size > 0) {
                    this.context.tileData.clearTileDownloadState(
                        Array.from(requestedTiles.values())
                    );
                    this.requestedTilesByBlock.delete(blockKey);
                }
                this.pendingBlocks.delete(blockKey);
                this.pendingRequestsByBlock.delete(blockKey);
            }
        }

        const restartRequests: any[] = [];
        for (const blockKey of Array.from(this.canceledBlocks.values())) {
            if (!currentViewBlocks.has(blockKey)) {
                continue;
            }
            if (this.pendingRequestsByBlock.has(blockKey)) {
                this.canceledBlocks.delete(blockKey);
                continue;
            }
            const hint = viewBlockHints.get(blockKey);
            if (!hint) {
                continue;
            }
            const requestId = this.nextRequestId++;
            const requestData: any = {
                face: hint.face,
                datasetId: hint.datasetId,
                parameter: hint.parameter,
                indexDimension: hint.indexDimension,
                indexValue: hint.indexValue,
                lod: hint.lod,
                xys: [],
                requestId
            };
            this.pendingBlocks.set(blockKey, {
                datasetId: hint.datasetId,
                parameter: hint.parameter,
                indexDimension: hint.indexDimension,
                indexValue: hint.indexValue
            });
            this.pendingRequestsByBlock.set(blockKey, new Set<number>([requestId]));
            restartRequests.push(requestData);
            this.canceledBlocks.delete(blockKey);
        }

        if (restartRequests.length > 0) {
            this.requestTileData(restartRequests);
        }
    }

    cancelAllRequests() {
        if (this.context.widgetMode) {
            return;
        }
        const blocks: any[] = [];
        const requestIds = new Set<number>();
        for (const block of this.pendingBlocks.values()) {
            blocks.push(block);
        }
        for (const pendingRequests of this.pendingRequestsByBlock.values()) {
            for (const requestId of pendingRequests.values()) {
                requestIds.add(requestId);
            }
        }
        if (blocks.length > 0 || requestIds.size > 0) {
            this.tileWebsocket.emit('cancel_tile_requests', {
                blocks,
                requestIds: Array.from(requestIds.values())
            });
        }
        this.pendingBlocks.clear();
        this.pendingRequestsByBlock.clear();
        this.canceledBlocks.clear();
        this.requestedTilesByBlock.clear();
        this.requestTilesById.clear();
    }

    async downloadTile(tile: Tile) {
        this.context.log(`Download tile ${tile}`);
        this.context.tileData.addTileDownloadsTriggered(1);
        const requestData: any = tile.getRequestData();
        if (!this.context.widgetMode) {
            const requestId = this.nextRequestId++;
            requestData.requestId = requestId;
            this.requestTilesById.set(requestId, [tile]);
            const blockKey = this.buildBlockKey(
                requestData.datasetId,
                requestData.parameter,
                requestData.indexDimension,
                requestData.indexValue
            );
            this.pendingBlocks.set(blockKey, {
                datasetId: requestData.datasetId,
                parameter: requestData.parameter,
                indexDimension: requestData.indexDimension,
                indexValue: requestData.indexValue
            });
            let pendingRequests = this.pendingRequestsByBlock.get(blockKey);
            if (!pendingRequests) {
                pendingRequests = new Set<number>();
                this.pendingRequestsByBlock.set(blockKey, pendingRequests);
            }
            pendingRequests.add(requestId);
            let requestedTiles = this.requestedTilesByBlock.get(blockKey);
            if (!requestedTiles) {
                requestedTiles = new Map<string, Tile>();
                this.requestedTilesByBlock.set(blockKey, requestedTiles);
            }
            requestedTiles.set(tile.getHashKey(), tile);
        }
        this.tileWebsocket.emit('request_tile_data', requestData);
    }

    async downloadTiles(requestedTiles: Tile[]) {
        this.context.tileData.addTileDownloadsTriggered(requestedTiles.length);
        const tilesToDownload: Tile[] = [];
        for (let t of requestedTiles) {
            const key = t.getHashKey();
            if (this.tileCache.has(key)) {
                this.context.tileData.receiveTile(t, this.tileCache.get(key));
                continue;
            }
            tilesToDownload.push(t);
        }

        this.context.log(
            `Download multiple tiles (Downloading: ${tilesToDownload.length} - Cached: ${requestedTiles.length - tilesToDownload.length})`
        );
        if (tilesToDownload.length > 0) {
            const tileGroups = new Map<string, Tile[]>();
            tilesToDownload.forEach((t) => {
                const key = `${t.cubeId}-${t.parameter}-${t.indexDimension()}-${t.indexValue}`;
                if (tileGroups.get(key)) {
                    tileGroups.get(key)?.push(t);
                } else {
                    tileGroups.set(key, [t]);
                }
            });

            let totalData: {}[] = [];
            for (let group of tileGroups.values()) {
                let xys: number[][] = [];
                group.forEach((t) => xys.push([t.x, t.y]));
                xys.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
                const requestData: any = group[0].getRequestDataWithMultipleXYs(xys);
                if (!this.context.widgetMode) {
                    const requestId = this.nextRequestId++;
                    requestData.requestId = requestId;
                    this.requestTilesById.set(requestId, group);
                    const blockKey = this.buildBlockKey(
                        requestData.datasetId,
                        requestData.parameter,
                        requestData.indexDimension,
                        requestData.indexValue
                    );
                    this.pendingBlocks.set(blockKey, {
                        datasetId: requestData.datasetId,
                        parameter: requestData.parameter,
                        indexDimension: requestData.indexDimension,
                        indexValue: requestData.indexValue
                    });
                    let pendingRequests = this.pendingRequestsByBlock.get(blockKey);
                    if (!pendingRequests) {
                        pendingRequests = new Set<number>();
                        this.pendingRequestsByBlock.set(blockKey, pendingRequests);
                    }
                    pendingRequests.add(requestId);
                    let requestedTiles = this.requestedTilesByBlock.get(blockKey);
                    if (!requestedTiles) {
                        requestedTiles = new Map<string, Tile>();
                        this.requestedTilesByBlock.set(blockKey, requestedTiles);
                    }
                    for (const tile of group) {
                        requestedTiles.set(tile.getHashKey(), tile);
                    }
                }
                totalData.push(requestData);
            }
            this.requestTileData(totalData);
        }
    }

    requestTileDataFromWidget?: (data: any) => void;

    private requestTileData(data: any) {
        if (this.context.widgetMode) {
            this.requestTileDataFromWidget!({
                request_type: 'request_tile_data_multiple',
                request_data: data
            });
        } else {
            for (const requestData of data) {
                this.tileWebsocket.emit('request_tile_data', requestData);
            }
        }
    }

    private buildBlockKey(
        datasetId: string,
        parameter: string,
        indexDimension: string,
        indexValue: number
    ) {
        return `${datasetId}/${parameter}/${indexDimension}/${indexValue}`;
    }

    async widgetVersionCheck() {
        try {
            const f = await fetch('https://version.lexcube.org');
            const j = await f.json();
            const new_version = j['current_lexcube_jupyter_version'];
            if (new_version != PACKAGE_VERSION) {
                this.context.interaction.showVersionOutofDateWarning(new_version, PACKAGE_VERSION);
            }
        } catch (error) {
            console.log('Could not fetch version information from version.lexcube.org');
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

    private nextRequestId = 1;
    private pendingRequestsByBlock = new Map<string, Set<number>>();
    private pendingBlocks = new Map<
        string,
        { datasetId: string; parameter: string; indexDimension: string; indexValue: number }
    >();
    private canceledBlocks = new Set<string>();
    private requestedTilesByBlock = new Map<string, Map<string, Tile>>();
    private requestTilesById = new Map<number, Tile[]>();

    private async fetchJson(url_path: string) {
        let full_url = `${this.apiServerUrl}${url_path}`;
        let key = `cached_api_response-${url_path}`;
        let stored = localStorage.getItem(key);
        if (this.useMetaDataCache && stored) {
            this.context.log('USING CACHED API METADATA:', full_url);
            return JSON.parse(stored);
        }
        try {
            const response = await fetch(full_url);
            const json = (await response.json()) as any;
            if (this.useMetaDataCache) {
                localStorage.setItem(key, JSON.stringify(json));
            }
            return json;
        } catch (error) {
            console.error('Could not fetch from', full_url, error);
            throw Error(`Could not fetch from ${full_url}, ${error}`);
        }
    }

    getFetchUrl(endpoint: string): any {
        return `${this.apiServerUrl}${endpoint}`;
    }
}

export { Networking };
