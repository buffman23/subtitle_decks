"""Host server resource stats (CPU / RAM / disk).

Runs inside the container, but since we set no cgroup CPU/memory limits on the
container, psutil's readings reflect the host. Disk usage of ``/`` reflects the
host's root filesystem (the container's overlay is backed by it).
"""
import psutil


def get_system_stats() -> dict:
    """Gather host CPU/RAM/disk stats."""
    vm = psutil.virtual_memory()
    disk = psutil.disk_usage("/")
    cpu_percent = psutil.cpu_percent(interval=0.3)  # short sample for a live reading

    try:
        load1, load5, load15 = psutil.getloadavg()
    except (OSError, AttributeError):
        load1 = load5 = load15 = None

    return {
        "cpu": {
            "percent": cpu_percent,
            "cores": psutil.cpu_count(logical=True),
            "physical_cores": psutil.cpu_count(logical=False),
            "load": [load1, load5, load15],
        },
        "memory": {
            "total": vm.total,
            "used": vm.used,
            "available": vm.available,
            "percent": vm.percent,
        },
        "disk": {
            "total": disk.total,
            "used": disk.used,
            "free": disk.free,
            "percent": disk.percent,
        },
    }
