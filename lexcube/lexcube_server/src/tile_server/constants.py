import os

UNCOMPRESSED_SUFFIX = "_uncompressed"
ANOMALY_PARAMETER_ID_SUFFIX = "_lxc_anomaly"
RGB_PARAMETER_ID_SUFFIX = "_lxc_rgb"

DEFAULT_PRE_GENERATION_SPARSITY = 8
DEFAULT_PRE_GENERATION_THREADS = 4
NAN_TILE_MAGIC_NUMBER = -1
LOSSLESS_TILE_MAGIC_NUMBER = -2
API_VERSION = 6
TILE_VERSION = 2
TILE_VERSION_3D = TILE_VERSION | 128  # set 8th bit to indicate 3D tile
DEFAULT_TILE_SIZE_2D = 256
DEFAULT_TILE_SIZE_3D = 256

TILE_VERSION_MASK = 255  # mask to get base tile version (lower 8 bits)

TILE_VERSION_FLAG_FLOAT32 = 256  # set 9th bit to indicate float32 tile data
TILE_VERSION_FLAG_FLOAT64 = 512  # set 10th bit to indicate float64 tile data
TILE_VERSION_FLAG_RGB_UINT8 = 1024  # set 11th bit to indicate uint8 RGB tile data

NON_EXTREME_QUANTILE_INDEX = 100  # assumed to be  =extreme_detection_result.high_quantile_first_index - 1

NAN_FACTOR_MASK_NAN_VALUE = 0
NAN_FACTOR_MASK_VALID_VALUE = 255

RGB_NAN_ALPHA_VALUE = 0

TILE_FORMAT_MAGIC_BYTES = "lexc".encode("utf-8")  # 6c 65 78 63, magic bytes to recognize lexcube tiles

TILE_FORMAT_ZFP = "zfp"
TILE_3D_FORMAT_VLQ = "vlq"
TILE_FORMAT_BLOSC_LZ4 = "blosc_lz4"
TILE_FORMAT_2D = "2D"

TILE_3D_FORMAT_TO_FILE_EXTENSION = {
    TILE_FORMAT_ZFP: "",
    TILE_3D_FORMAT_VLQ: ".vlq",
    TILE_FORMAT_BLOSC_LZ4: ".blosc_lz4",
}

LONGITUDE_DIMENSION_NAMES = ["longitude", "lon"]
LATITUDE_DIMENSION_NAMES = ["latitude", "lat"]
GEOSPATIAL_X_DIMENSION_NAMES = ["x"] + LONGITUDE_DIMENSION_NAMES
GEOSPATIAL_Y_DIMENSION_NAMES = ["y"] + LATITUDE_DIMENSION_NAMES
TIME_DIMENSION_NAMES = ["time"]
BAND_DIMENSION_NAMES = ["band", "bands", "channel", "channels"]

DEFAULT_DIMENSIONS = ["Z", "Y", "X"]
DEFAULT_DIMENSIONS_4D = ["Z", "Y", "X", "band"]
DEFAULT_VARIABLE_NAME = "default_var"

DEFAULT_LOG_PATH = "logs"

DISK_CACHE_SUBDIR = ".tiles"
DISK_CACHE_VERSION = "v1"
DISK_CACHE_SIZE_REFRESH_INTERVAL = 100
DEFAULT_CACHE_LOCAL_MAX_GB = 10.0
DEFAULT_CACHE_LOCAL_DIR = os.path.join(os.path.expanduser("~"), ".cache", "lexcube")
