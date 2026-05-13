import {
    DOMWidgetModel,
    DOMWidgetView,
    ISerializers,
} from '@jupyter-widgets/base';

import { MODULE_NAME, MODULE_VERSION } from './version';

import { CubeClientContext } from './lexcube-client/src/client/client'
import { DEFAULT_WIDGET_HEIGHT, DEFAULT_WIDGET_WIDTH, Dimension } from './lexcube-client/src/client/constants';
import loaderVideoPath from '../src/lexcube-client/src/client/public/loader.mp4';
import fullscreenIconPath from '../src/lexcube-client/src/client/public/fullscreen.svg';
import pauseIconPath from '../src/lexcube-client/src/client/public/pause.svg';
import playIconPath from '../src/lexcube-client/src/client/public/play.svg';
import downloadIconPath from '../src/lexcube-client/src/client/public/download.svg';
import slidersIconPath from '../src/lexcube-client/src/client/public/sliders.svg';
import lexcubeLogoPath from '../src/lexcube-client/src/client/public/lexcube-logo.png';
import enableVolumeVizIconPath from '../src/lexcube-client/src/client/public/enable-volume-viz.svg';
import disableVolumeVizIconPath from '../src/lexcube-client/src/client/public/disable-volume-viz.svg';
import svgTemplate from '../src/lexcube-client/src/client/public/paper-cube-template-v4.svg?raw';

import lessThanIconPath from '../src/lexcube-client/src/client/public/less-than.svg';
import intervalIconPath from '../src/lexcube-client/src/client/public/interval.svg';
import greaterThanIconPath from '../src/lexcube-client/src/client/public/greater-than.svg';

import locationIconPath from '../src/lexcube-client/src/client/public/location.svg';

import '../src/lexcube-client/src/client/public/style.css'
import '../css/widget.css';

const htmlCode = `<div class="print-template-wrapper" style="display: none">${svgTemplate}</div>
<div class="fullscreen-wrapper flex-col-center print-template-result-wrapper" style="background-color: rgba(0, 0, 0, 1); display: none; z-index: 20;">
    <div class="ui-normal flex-col-center" style="box-shadow: 10px 10px 20px black;max-height:95%" onclick="event.stopPropagation()">
        <div class="print-template-loading-section flex-col-center noselect" style="padding: 20px;">
            <div class="logo" style="padding:20px;width:90px;height:90px">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="25 25 50 50" preserveAspectRatio="xMidYMid" style="shape-rendering: auto; display: block; background: transparent;" width="100%" height="100%" xmlns:xlink="http://www.w3.org/1999/xlink"><g><g transform="rotate(0 50 50)">
            <rect fill="#8982b0" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-1.1111111111111112s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(20 50 50)">
            <rect fill="#e8736c" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-1.0457516339869282s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(40 50 50)">
            <rect fill="#435179" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.9803921568627452s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(60 50 50)">
            <rect fill="#8982b0" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.9150326797385622s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(80 50 50)">
            <rect fill="#e8736c" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.8496732026143792s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(100 50 50)">
            <rect fill="#435179" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.7843137254901962s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(120 50 50)">
            <rect fill="#8982b0" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.7189542483660131s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(140 50 50)">
            <rect fill="#e8736c" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.6535947712418301s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(160 50 50)">
            <rect fill="#435179" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.5882352941176471s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(180 50 50)">
            <rect fill="#8982b0" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.5228758169934641s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(200 50 50)">
            <rect fill="#e8736c" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.4575163398692811s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(220 50 50)">
            <rect fill="#435179" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.3921568627450981s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(240 50 50)">
            <rect fill="#8982b0" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.32679738562091504s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(260 50 50)">
            <rect fill="#e8736c" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.26143790849673204s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(280 50 50)">
            <rect fill="#435179" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.19607843137254904s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(300 50 50)">
            <rect fill="#8982b0" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.13071895424836602s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(320 50 50)">
            <rect fill="#e8736c" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="-0.06535947712418301s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g transform="rotate(340 50 50)">
            <rect fill="#435179" height="6" width="6" ry="3" rx="3" y="27" x="47">
              <animate repeatCount="indefinite" begin="0s" dur="1.1764705882352942s" keyTimes="0;1" values="1;0" attributeName="opacity"></animate>
            </rect>
          </g><g></g></g></svg>
            </div>
            <div>Building your own data cube...</div>
        </div>
        <div class="print-template-result-section" style="display: none;max-height: 100%;overflow-y: auto;">
            <div class="flex-col-center" style="gap: 10px;text-align: center;height: 100%;">
                <h1>Craft Your Data Cube!</h1>
                <div>Print🖨️, fold📃, cut✂️ and glue🩹 to make your own crafted data cube. 🧊</div>
                <div style="display: flex; flex-direction: row;gap: 10px;justify-content: center;">
                    <a class="download-print-template-result-svg" style="font-size: larger;">Download SVG</a>
                    <a class="download-print-template-result-png" style="font-size: larger;">Download PNG</a>
                    <a class="download-print-template-result-edit-note" style="font-size: larger;" href="#">Add custom note</a>
                </div>
                <div class="print-template-result"></div>
                <button style="font-size: larger; margin: 10px" onclick="const d = this.parentNode.parentNode.parentNode.parentNode;d.style.display = 'none';">Close</button>
            </div>
        </div>
    </div>
</div>

<div class="fullscreen-wrapper nopointer noselect" style="text-align: center; color:white">
<div style="position: absolute" class="axis-label-parent axis-label-parent-x-min"><div class="axis-label axis-label-x-min"></div></div>
<div style="position: absolute" class="axis-label-parent axis-label-parent-x-max"><div class="axis-label axis-label-x-max"></div></div>
<div style="position: absolute" class="axis-label-parent axis-label-parent-x-dimension-name"><div class="axis-label axis-label-x-dimension-name"></div></div>
<div style="position: absolute" class="axis-label-parent axis-label-parent-y-min"><div class="axis-label axis-label-y-min"></div></div>
<div style="position: absolute" class="axis-label-parent axis-label-parent-y-max"><div class="axis-label axis-label-y-max"></div></div>
<div style="position: absolute" class="axis-label-parent axis-label-parent-y-dimension-name"><div class="axis-label axis-label-y-dimension-name"></div></div>
<div style="position: absolute" class="axis-label-parent axis-label-parent-z-min"><div class="axis-label axis-label-z-min"></div></div>
<div style="position: absolute" class="axis-label-parent axis-label-parent-z-max"><div class="axis-label axis-label-z-max"></div></div>
<div style="position: absolute" class="axis-label-parent axis-label-parent-z-dimension-name"><div class="axis-label axis-label-z-dimension-name"></div></div>
</div>

  <div class="fullscreen-wrapper noselect nopointer flex-row-center-end">
      <div style="width: 25%; height: 45%; margin-right: 1.5%; display: none; background-color: rgba(0, 0, 0, 0.8); border-radius: 5px;position: relative; padding: 5px;" class="time-series-ui">
          <div style="position: absolute; top: -17px; right: -3px; cursor: pointer; color:white; pointer-events: all; padding: 5px; font-weight: bold;" class="time-series-close-button">x</div>
          <canvas class="time-series-canvas" style="pointer-events:all;"></canvas>
      </div>
  </div>


<div class="fullscreen-wrapper noselect nopointer corner-logo-ui">
<div class="dataset-info-corner">
<div class="dataset-info-corner-list" style="display: flex;flex-direction: column;align-items: flex-end;overflow:hidden;">
<img class="corner-logo" style="max-width: 300px; width: 100%; opacity: 0.8;margin-bottom: 1.7%;margin-right: 1.5%;" alt="" src="${lexcubeLogoPath}" />
</div>
</div>
</div>


<div class="toolbar-ui">
<div class="toolbar-ui-button fullscreen-button" title="Enter/exit fullscreen" style="background-image: url('${fullscreenIconPath}');"></div>
<div class="toolbar-ui-button data-select-button"       title="Options" onclick="let c = this.parentNode.parentNode.getElementsByClassName('options-ui')[0]; c.style.display = c.style.display == 'none' ? 'block' : 'none';" style="background-image: url('${slidersIconPath}');"></div>
<div class="toolbar-ui-button download-image-button" title="Download" style="display:none;background-image: url('${downloadIconPath}');"></div>
<div class="toolbar-ui-button gps-button"               title="Show Current Location on Cube"   style="display:none;background:url('${locationIconPath}');"></div>
<div class="toolbar-ui-button enable-volume-viz-button" title="Enable Volume Visualization" style="background-image: url('${enableVolumeVizIconPath}'); display:none;"></div>
<div class="toolbar-ui-button disable-volume-viz-button" title="Disable Volume Visualization" style="background-image: url('${disableVolumeVizIconPath}');display:none;"></div>
<div class="animation-dropdown noselect">
    <div class="toolbar-ui-button animate-start-button" title="Start Animation" style="background-image: url('${playIconPath}');"></div>
    <div class="toolbar-ui-button animate-stop-button" title="Stop Animation" style="display:none;background-image: url('${pauseIconPath}');"></div>

    <div class="animation-dropdown-content">
          <div class="ui-normal noselect animation-settings-ui">
            <h3>Animation Settings</h3>
            <div>Animated Dimension:</div>
            <select class="animation-dimension-select noselect" style="width: fit-content;
                    margin-top: 3px;
                    margin-bottom: 3px;
                    font-size: 1em;
                    color: black;">
                <option value="x">X</option>
                <option value="y">Y</option>
                <option value="z" selected >Z</option>
            </select>
            <hr style="width: 100%;">

            <div>Increment per Step:</div>
            <div class="slider animation-increment-slider"></div>
            <div>Visible Window:</div>
            <div class="slider animation-window-slider"></div>
            <div>Animation Speed:</div>
            <div class="slider animation-speed-slider"></div>
            <div>Total Time: <span class="animation-total-duration" style="font-weight: bold;">10.5</span> s</div>
            <hr style="width: 100%;">
            <label class="animation-selected-range-only-checkbox-label"><input type="checkbox" class="animation-selected-range-only-checkbox" name="animation-selected-range-only"/><div class="animation-selected-range-only-checkbox-label-div" style="display: contents;"> Only animate last selection (X to Y)</div></label>
            <hr style="width: 100%;">
            <div>
                <label class="animation-recording-checkbox-label"><input type="checkbox" class="animation-recording-checkbox" name="animation-recording"/> Record Animation</label>
                <div class="animation-recording-in-progress-panel" style="display: none;">
                    <div class="animation-recording-status" style="color: rgb(255, 43, 48); font-weight: bold;width: 100%;text-align: center;">Recording Animation...</div>
                    <button class="animation-recording-stop-button" style="width: 100%;">
                        Stop Recording
                    </button>
                </div>
            </div>
            <div class="animation-recording-options" style="display: none;">
                <button class="animation-recording-restart-button">
                    Start Recording
                </button>
                <select class="animation-recording-format">
                    <option value="MP4">MP4 (default)</option>
                    <option value="WebM">WebM (smaller files)</option>
                    <option value="GIF">GIF (large files, slow)</option>
                </select>
            </div>
        </div>
    </div>
</div>
</div>

    <div class="fullscreen-wrapper nopointer noselect">
        <!-- center horizontally and vetically-->
         <div class="resolution-change-popup" style="display: none; justify-content: center; align-items: center; height: 100%; ">
                <div style='width: 250px; height: 340px; display:flex; align-items: center; gap: 1rem; margin-top: 0.5rem; margin-bottom: 0.5rem; flex-direction: column; padding-left: 2rem; padding-right: 2rem; padding-top: 1rem; padding-bottom: 2rem; background-color: rgba(4, 9, 25); box-shadow: 0 0 30px rgba(0, 0, 0, 0.5); '>
                    <video playsinline loop muted autoplay style='height: auto; width: 250px;'>
                        <source src="${loaderVideoPath}" type="video/mp4">
                    </video>
                    <div style="display: flex; flex-direction: column; align-items: center; gap: 0.5rem;">
                        <div class="resolution-change-heading" style='font-size: 1.3rem; color:white; text-align: center;'>Expanding 3D storage...</div>
                        <div class="resolution-change-label" style='font-size: 0.8rem; color:white; text-align: center;'>(100% resolution)</div>
                    </div>
            </div>
         </div>
    </div>

    <div class="flex-col-center-end noselect">
        <div class="volume-viz-section ui-normal" style="max-width: 800px; max-height: 250px; bottom: 2.5%; position: absolute; display: none; flex-direction: row; gap: 5px;">
            <div class="volume-viz-loader-column" style="width: 400px; display: flex; flex-direction: column; flex: 1; justify-content: center; align-items: center;">
                <div style="color: white; margin-top: 10px;">Loading voxel visualization...</div>
                <video playsinline loop muted autoplay style='height: auto; width: 120px;'>
                    <source src="${loaderVideoPath}" type="video/mp4">
                </video>
            </div>
            <div class="volume-viz-main-column" style="width: 400px; display: none; flex-direction: column; flex: 1;">
                <div class="volume-viz-description-row" style="margin: 15px 20px 10px 20px;">
                    Showing <span class="volume-viz-threshold-target" style="background-color: rgb(66, 44, 87); cursor: pointer;">anomalies (deviations from mean seasonal cycle)</span> <span class="volume-viz-threshold-type" style="background-color: rgb(50, 64, 25); cursor: pointer;">above the 99th percentile</span> <span class="volume-viz-threshold-spatial-quantile-context" style="background-color: rgb(0, 75, 100); cursor: pointer;">across all locations</span>.
                    <br><span class="volume-viz-event-explore-link" style="text-decoration: underline; cursor: pointer; display: block; text-align: center;"
                        onclick="const t = document.getElementsByClassName('volume-viz-event-column')[0]; t.style.display = t.style.display == 'none' ? 'block' : 'none';"
                    >Explore 42 events ></span>
                </div>

                <div class="volume-viz-slider-row" style="display: flex; flex-direction: row; align-items: center;">
                    <div class="volume-viz-threshold-slider-signs" style="width:32px;display: flex; flex-direction: column; cursor: pointer;"> 
                        <div class="volume-viz-threshold-slider-sign-less-than" style="width: 24px;height: 24px; background-size: cover; background-image: url('${lessThanIconPath}');"></div>
                        <div class="volume-viz-threshold-slider-sign-interval" style="width: 24px;height: 24px; background-size: cover; background-image: url('${intervalIconPath}');"></div>
                        <div class="volume-viz-threshold-slider-sign-greater-than" style="width: 24px;height: 24px; background-size: cover; background-image: url('${greaterThanIconPath}');"></div>
                    </div>

                    <div class="slider-parent" style="flex: 2; padding: 0px;">
                        <div class="slider volume-viz-threshold-slider"></div>
                    </div>

                    <div class="slider-parent" style="flex: 2; padding: 0px;">
                        <div class="slider volume-viz-range-slider"></div>
                    </div>
                    
                    <div class="slider-parent" style="flex: 2; padding: 0px;">
                        <div class="slider volume-viz-quantile-slider"></div>
                    </div>
    
                </div>
                <div class="volume-viz-stats-row expert-mode" style="display: block; flex-direction: row; align-items: center; font-size: x-small; text-align: center;">
                    Loading...
                </div>
            </div>
            <div class="volume-viz-event-column" style="width: 400px; flex: 1; max-height: 215px; overflow: auto; display: none; padding: 5px;">
                <table style="border-collapse:collapse; font-size: small;" class="volume-viz-event-table">
                    <thead>
                        <tr>
                        <th>ID</th>
                        <th>#obs</th>
                        <th style="min-width: 78px;">Start / End</th>
                        <th>Spatial Extent</th>
                        <th>Location</th>
                        </tr>
                    </thead>
                    <tbody class="volume-viz-event-table-body">
                        <tr>
                        <td>#1</td>
                        <td>3 obs</td>
                        <td>02 Dec 2008 /<br>09 Dec 2008</td>
                        <td>402 km²<br>(51×42)</td>
                        <td>22°22'30''N /<br>103°22'30''W</td>
                        </tr>
                    </tbody>
                </table>
            </div>

        </div>
    </div>

<div class="flex-col-center-end noselect bottom-left-ui" style="max-width: 30%;">
    <div class="ui-normal nopointer hover-info-ui"></div>

    <div class="colormap-options flex-col-center-end noselect ui-normal" style="max-height: 50%; overflow-x: clip; overflow-y: auto; max-width: 220px; display: none;">
        <div class="colormap-section" style="overflow-y: auto;">
            <div class="btn-group colormap-list" style="overflow-y: auto;">

            </div>
        </div>
        <div class="colormap-settings" style="width: 100%; display: flex; flex-direction: column; gap: 2px;">
            <hr style="width: 100%;">
            Colormap Range:<br>
            <form class="colormap-range-form">
                <input type="text" class="colormap-min-input" placeholder="1.0" style="width:5.5em"/> -
                <input type="text" class="colormap-max-input" placeholder="1.0" style="width:5.5em"/>
                <input type="submit" value="Apply" style="width: 3em; display: none;"/>
            </form>
            <div>
                <label><input type="checkbox" class="colormap-flipped-checkbox" name="colormap-flipped"> Flip Colormap</label>
            </div>
            <div class="expert-mode">
                <label><input type="checkbox" class="colormap-percentile-checkbox" name="colormap-percentile" checked> For automatic boundaries: only consider ± 2.5 σ (98.7% of data points)</label>
            </div>
        </div>
    </div>
    <div class="flex-col-center-end color-scale">
        <div class="color-scale-gradient"></div>
        <div class="color-scale-labels">
            <div class="color-scale-label"></div>
            <div class="color-scale-label"></div>
            <div class="color-scale-label"></div>
        </div>
        <div class="color-scale-unit-label"></div>
    </div>
</div>

<div class="ui-normal noselect options-ui" style="display: none; max-width: 250px;">
<button type="button" class="collapsible-button" onclick="this.parentNode.style.display = 'none';">Close</button>
<hr>
<div style='display: none;'>
    Cube:<br>
    <select class="cube-select">
        <option value="0"></option>
    </select>
</div>
<div style='display: none;'>
    Parameter:<br>
    <select class="parameter-select">
        <option value="0"></option>       
    </select>
</div>
<div style='display: none;'>
    Display Quality:<br>
    <select class="quality-select">
        <option value="0.2" label="Very Low (20%)"></option>
        <option value="0.5" label="Low (50%)"></option>
        <option value="1.0" label="Default (100%)" selected></option>
        <option value="1.5" label="High (150%)"></option>
        <option value="2.0" label="Very High (200%)"></option>
        <option value="1000.0" label="Data Resolution"></option>
    </select>
</div>
<h3 class="noselect" style="cursor: pointer;">Current Selection</h3>
<div class="selection-section">
    <div class="x-selection-slider-label">X:</div>
    <div>
        <div class="slider x-selection-slider"></div>
    </div>
    <div class="y-selection-slider-label">Y:</div>
    <div>
        <div class="slider y-selection-slider"></div>
    </div>
    <div class="z-selection-slider-label">Z:</div>
    <div>
        <div class="slider z-selection-slider"></div>
    </div>
</div>

</div>

<div class="fullscreen-wrapper nopointer noselect">
<div style="text-align: center; margin-top: 3%;">
    <div class="status-message">Starting LexCube...</div>
</div>
</div>
<div class="fullscreen-wrapper flex-col-center dataset-info-wrapper">
<div class="ui-normal flex-col-center dataset-info-window">
    <div class="dataset-info" style="max-width: 100%; overflow-y: auto; overflow-x: hidden;"></div>
    
    <div style="width: 100%; text-align: center;">  
        <hr>
        <div class="expert-mode">
            Lexcube is an interactive visualization of large-scale earth data sets. Created at Leipzig University by Maximilian Söchting.
        </div>
    </div>
    <button style="margin-top: 10px" onclick="this.parentNode.parentNode.style.display = 'none'">Acknowledge</button>
</div>
</div>`;

const template = `<div class="lexcube-body" style="width: ${DEFAULT_WIDGET_WIDTH}px; height: ${DEFAULT_WIDGET_HEIGHT}px; position: relative;">${htmlCode}</div>`;


export class Cube3DModel extends DOMWidgetModel {
    defaults() {
        return {
            ...super.defaults(),
            _model_name: Cube3DModel.model_name,
            _model_module: Cube3DModel.model_module,
            _model_module_version: Cube3DModel.model_module_version,
            _view_name: Cube3DModel.view_name,
            _view_module: Cube3DModel.view_module,
            _view_module_version: Cube3DModel.view_module_version,
        };
    }

    static serializers: ISerializers = {
        ...DOMWidgetModel.serializers,
        // Add any extra serializers here
    };

    static model_name = 'Cube3DModel';
    static model_module = MODULE_NAME;
    static model_module_version = MODULE_VERSION;
    static view_name = 'Cube3DView'; // Set to null if no view
    static view_module = MODULE_NAME; // Set to null if no view
    static view_module_version = MODULE_VERSION;
}

export class Cube3DView extends DOMWidgetView {
    private cubeClientContext: CubeClientContext;

    render(): void {
        this.el.innerHTML = template;
        this.cubeClientContext = new CubeClientContext(true, this.el.getElementsByClassName("lexcube-body")[0] as HTMLElement, this.model.get("isometric_mode"), this.model.get("cube_scale"), this.model.get("force_float32_for_voxel_mode"));
        const featureCheck = this.cubeClientContext.checkForFeatures();
        console.log("LexCube feature check:", featureCheck ? "Success" : "Failed");
        if (!featureCheck.success) {
          this.el.innerHTML = `LexCube failed to start.<br>Error message: ${featureCheck.message}`;
          return;
        }
        this.widgetSizeChanged();

        this.cubeClientContext.widgetPostStartup = this.postStartup.bind(this);
        this.cubeClientContext.interaction.updateWidgetModelRanges = this.updateWidgetRanges.bind(this);
        this.cubeClientContext.interaction.updateWidgetCameraAngle = this.updateWidgetCameraAngle.bind(this);
        this.cubeClientContext.interaction.updateWidgetModelColormapRange = this.updateColormapRange.bind(this);
        this.cubeClientContext.rendering.updateWidgetModelDimensionWrapSettings = this.updateDimensionWrapSettings.bind(this);
        this.cubeClientContext.interaction.updateWidgetColormap = this.updateColormap.bind(this);
        // window.setTimeout(this.cubeClientContext.startup.bind(this.cubeClientContext), 500);
        this.el.classList.add('lexcube');
        this.cubeClientContext.networking.requestTileDataFromWidget = this.requestTileData.bind(this);
        this.cubeClientContext.networking.fetchMetadataFromWidget = this.fetchMetadata.bind(this);

        this.model.on('change:request_progress', this.requestProgressChanged, this);
        this.model.on('change:vmin', this.colormapMinChanged, this);
        this.model.on('change:vmax', this.colormapMaxChanged, this);
        this.model.on('change:cmap', this.colormapChanged, this);

        this.model.on('change:overlaid_geojson', this.regionBordersChanged, this);
        this.model.on('change:overlaid_geojson_color', this.regionBordersColorChanged, this);
        
        this.model.on('change:xlim', this.widgetRangeChanged, this);
        this.model.on('change:ylim', this.widgetRangeChanged, this);
        this.model.on('change:zlim', this.widgetRangeChanged, this);

        this.model.on('change:xwrap', this.dimensionWrapSettingsChanged, this);
        this.model.on('change:ywrap', this.dimensionWrapSettingsChanged, this);
        this.model.on('change:zwrap', this.dimensionWrapSettingsChanged, this);

        this.model.on('change:widget_size', this.widgetSizeChanged, this);
        this.model.on('change:camera_angle', this.cameraAngleChanged, this);

        this.model.on('msg:custom', this.handleMessage, this);

        this.cubeClientContext.startup();
    }

    postStartup(): void {
        this.colormapChanged();
        this.colormapMinChanged();
        this.colormapMaxChanged();
        this.widgetRangeChanged();
        this.updateWidgetRanges();
        this.cameraAngleChanged();
        this.dimensionWrapSettingsChanged(true);
        this.regionBordersChanged();
        this.regionBordersColorChanged();
    }

    private requestTileData(data: any): void {
        this.send(data);
    }

    private async fetchMetadata(url_path: string): Promise<any> {
        return this.model.get("api_metadata")[url_path];
    }

    private handleMessage(payload: any, buffers: DataView[]): void {
        if (payload.response_type == "tile_data") {
            this.cubeClientContext.networking.onTileData(payload, buffers[0].buffer);
        } else if (payload.response_type == "download_figure_request") {
            this.cubeClientContext.rendering.downloadScreenshotFromUi(payload.includeUi, payload.filename, payload.dpiscale)
        } else if (payload.response_type == "download_print_template_request") {
            this.cubeClientContext.rendering.startDownloadPrintTemplate(); // payload.filename
        }
    }

    private widgetRangeChanged(): void {
        const xRange = this.getModelValue("xlim");
        const yRange = this.getModelValue("ylim");
        const zRange = this.getModelValue("zlim");
        this.cubeClientContext.interaction.cubeSelection.parseSelectionBoundariesFromWidget(xRange[0], xRange[1], yRange[0], yRange[1], zRange[0], zRange[1]);
    }

    private widgetSizeChanged(): void {
        const size = this.model.get('widget_size') || [DEFAULT_WIDGET_WIDTH, DEFAULT_WIDGET_HEIGHT];
        this.cubeClientContext.rendering.setWidgetSize(size[0] * 80, size[1] * 80); // inch to pixels at default DPI
    }

    private cameraAngleChanged(): void {
        const cameraAngle = this.getModelValue("camera_angle");
        if (cameraAngle.length != 6 || cameraAngle.some((v: any) => typeof v !== "number") || cameraAngle.every((v: any) => v === 0)) {
            this.cubeClientContext.interaction.applyCameraPreset(undefined, undefined, undefined, true);
            this.cubeClientContext.rendering.updateVisibilityAndLods();
            this.updateWidgetCameraAngle(); // sending changes back to model
            return;
        }
        const position = { x: cameraAngle[0], y: cameraAngle[1], z: cameraAngle[2] };
        const rotation = { x: cameraAngle[3], y: cameraAngle[4], z: cameraAngle[5] };
        this.cubeClientContext.interaction.applyCameraPreset(undefined, undefined, { position, rotation }, true);
        this.cubeClientContext.rendering.updateVisibilityAndLods();
    }

    dimensionWrapSettingsChanged(allowWidgetPropertyUpdate: boolean = false): void {
        this.cubeClientContext.rendering.updateOverflowSettings(this.getModelValue("xwrap"), this.getModelValue("ywrap"), this.getModelValue("zwrap"), allowWidgetPropertyUpdate);
    }

    updateDimensionWrapSettings(xWrap: boolean, yWrap: boolean, zWrap: boolean): void {
        this.model.set({ 'xwrap': xWrap, 'ywrap': yWrap, 'zwrap': zWrap }, { silent: true});
        this.model.save_changes();
    }

    updateColormap(cmap: string): void {
        this.model.set({ 'cmap': cmap }, { silent: true });
        this.model.save_changes();
    }

    private updateWidgetRanges(): void {
        const xRange = this.cubeClientContext.interaction.cubeSelection.getSelectionRangeByDimension(Dimension.X);
        const yRange = this.cubeClientContext.interaction.cubeSelection.getSelectionRangeByDimension(Dimension.Y);
        const zRange = this.cubeClientContext.interaction.cubeSelection.getSelectionRangeByDimension(Dimension.Z);
        this.model.set({ 'xlim': [xRange.min, xRange.max], 'ylim': [yRange.min, yRange.max], 'zlim': [zRange.min, zRange.max] }, { silent: true }); 
        this.model.save_changes();
    }

    private updateWidgetCameraAngle(): void {
        const targetPrecision = 3;
        const c = this.cubeClientContext.rendering.getCurrentCamera();
        const p = c.position.toArray().map((v, i) => parseFloat(v.toFixed(targetPrecision)));
        const r = [c.rotation.x, c.rotation.y, c.rotation.z].map((v, i) => parseFloat(v.toFixed(targetPrecision)));
        this.model.set({ 'camera_angle': p.concat(r) }, { silent: true });
        this.model.save_changes();
    }

    private getModelValue(key: string) {
        const v = this.model.get(key);
        return (v !== null && v !== undefined) ? v : undefined;
    }

    private colormapMinChanged(): void {
      this.colormapRangeChangedFromModel(false);
    }

    private colormapMaxChanged(): void {
      this.colormapRangeChangedFromModel(true);
    }

    private colormapRangeChangedFromModel(maxChanged: boolean): void {
        if (maxChanged) {
          this.cubeClientContext.tileData.colormapMaxValueOverride = this.getModelValue("vmax") !== undefined ? this.getModelValue("vmax") : null;
        } else {
          this.cubeClientContext.tileData.colormapMinValueOverride = this.getModelValue("vmin") !== undefined ? this.getModelValue("vmin") : null;
        }
        this.cubeClientContext.tileData.colormapHasChanged(true, false);
        this.cubeClientContext.interaction.updateColormapRangePlaceholders();
        this.cubeClientContext.interaction.updateColormapRangeUiFromValues();
    }

    updateColormapRange(vmin: number | null, vmax: number | null): void {
        this.model.set({ 'vmin': vmin, 'vmax': vmax }, { silent: true });
        this.model.save_changes();
    }

    private regionBordersColorChanged() {
        const color = this.model.get('overlaid_geojson_color') || "black";
        this.cubeClientContext.rendering.setRegionBordersColor(color);
    }

    private async regionBordersChanged() {
        const geojson = this.model.get('overlaid_geojson') || null;
        if (!geojson) {
            this.cubeClientContext.rendering.clearRegionBordersForWidget();
            return;
        }
        this.cubeClientContext.rendering.loadRegionBordersFromGeoJsonForWidget(geojson);
    }

    private colormapChanged(): void {
        let cmap = this.model.get('cmap');
        let colormapHasChanged = false;
        if (cmap === null || cmap === "") {
            return;
        }
        const previouslyFlipped = this.cubeClientContext.tileData.getColormapFlipped();
        this.cubeClientContext.tileData.setColormapFlipped(false);
        if (typeof (cmap) == "string") {
            const colormapReversed = cmap.endsWith("_r");
            if (colormapReversed) {
                cmap = cmap.substring(0, cmap.length - 2);
            }
            const colormapReversedHasChanged = previouslyFlipped != colormapReversed;
            this.cubeClientContext.tileData.setColormapFlipped(colormapReversed);
            colormapHasChanged = this.cubeClientContext.interaction.selectColormapByName(cmap);
            this.cubeClientContext.tileData.colormapHasChanged(colormapReversedHasChanged, colormapHasChanged);
        } else if ((cmap as number[][]).length && cmap[0].length && typeof (cmap[0][0]) == "number") {
            try {
                const rgb8Data = this.cubeClientContext.interaction.convertColormapDataToRGB8(cmap as number[][]);
                colormapHasChanged = this.cubeClientContext.interaction.selectColormapByData(rgb8Data);
                this.cubeClientContext.interaction.deselectColormapInUi();
            } catch (error) {
                console.log("Failed to select colormap by data", error);
            }
        }
        this.model.save_changes();
        if (colormapHasChanged) {
            this.cubeClientContext.tileData.colormapHasChanged(false, true);
        }
    }

    private requestProgressChanged(): void {
        this.cubeClientContext.interaction.updateRequestProgressFromWidget(this.model.get('request_progress')["progress"], this.model.get('request_progress_reliable_for_timing'));
    }
}




