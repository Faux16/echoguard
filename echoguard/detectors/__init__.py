"""Built-in detectors."""

from .base import Detector, Finding
from .ultrasonic import OutOfBandEnergyDetector
from .modulation import CarrierPeakDetector
from .spectral import SpectralProfileDetector


def default_detectors() -> list[Detector]:
    """The default detector set EchoGuard runs."""
    return [
        OutOfBandEnergyDetector(),
        CarrierPeakDetector(),
        SpectralProfileDetector(),
    ]


__all__ = [
    "Detector",
    "Finding",
    "OutOfBandEnergyDetector",
    "CarrierPeakDetector",
    "SpectralProfileDetector",
    "default_detectors",
]
