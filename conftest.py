import importlib.util
import os

import pytest


def _has_module(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def _enabled(flag_name: str) -> bool:
    return os.getenv(flag_name, '').lower() in {'1', 'true', 'yes', 'on'}


def pytest_collection_modifyitems(config: pytest.Config, items: list[pytest.Item]) -> None:
    for item in items:
        nodeid = item.nodeid

        if nodeid.startswith('examples/3_spectral_indices_with_cubo_and_spyndex.ipynb'):
            missing = [m for m in ['spyndex', 'cubo', 'sen2nbar'] if not _has_module(m)]
            if missing:
                item.add_marker(
                    pytest.mark.skip(
                        reason=(
                            'Requires optional dependencies for spectral-index example: '
                            f"{', '.join(missing)}. Install them and rerun pytest to unskip."
                        )
                    )
                )
                continue
            if not _enabled('LEXCUBE_RUN_EXTERNAL_NOTEBOOKS'):
                item.add_marker(
                    pytest.mark.skip(
                        reason=(
                            'External-data notebook test is disabled by default. '
                            'Set LEXCUBE_RUN_EXTERNAL_NOTEBOOKS=1 to run it.'
                        )
                    )
                )
            continue

        if nodeid.startswith('examples/4_google_earth_engine.ipynb'):
            if not _has_module('ee'):
                item.add_marker(
                    pytest.mark.skip(
                        reason=(
                            'Requires Google Earth Engine Python API (module `ee`). '
                            'Install `earthengine-api` and authenticate to unskip.'
                        )
                    )
                )
                continue
            if not _enabled('LEXCUBE_RUN_EE_NOTEBOOKS'):
                item.add_marker(
                    pytest.mark.skip(
                        reason=(
                            'Google Earth Engine notebook test is disabled by default. '
                            'Set LEXCUBE_RUN_EE_NOTEBOOKS=1 after configuring auth to run it.'
                        )
                    )
                )
            continue

        if nodeid.startswith('examples/5_spectral_indices_with_open_eo.ipynb'):
            if not _has_module('openeo'):
                item.add_marker(
                    pytest.mark.skip(
                        reason=(
                            'Requires OpenEO client (module `openeo`). '
                            'Install `openeo` and configure authentication to unskip.'
                        )
                    )
                )
                continue
            if not _enabled('LEXCUBE_RUN_OPENEO_NOTEBOOKS'):
                item.add_marker(
                    pytest.mark.skip(
                        reason=(
                            'OpenEO notebook test is disabled by default. '
                            'Set LEXCUBE_RUN_OPENEO_NOTEBOOKS=1 after configuring auth to run it.'
                        )
                    )
                )
