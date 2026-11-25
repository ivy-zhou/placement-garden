"""Check every level's target layout against real `distribute_tensor`.

Each rank of a fake process group distributes `torch.arange(n).reshape(shape)` with the level's
reference placements (`src_data_rank=None`, so every rank cuts its own piece without collectives)
and reports its local tensor's elements in order, which the game's layout must match exactly
(the reverse mode asks for local positions, so order matters as well as membership). Run with a Python that has torch:

    node test/export_levels.js > /tmp/levels.json && <torch python> test/torch_check.py /tmp/levels.json
"""

import json
import math
import sys

import torch
import torch.distributed as dist
from torch.distributed.device_mesh import init_device_mesh
from torch.distributed.tensor import distribute_tensor, Replicate, Shard
from torch.distributed.tensor.placement_types import _StridedShard
from torch.testing._internal.distributed.fake_pg import FakeStore


def to_placement(p):
    if p["kind"] == "S":
        return Shard(p["dim"])
    if p["kind"] == "SS":
        return _StridedShard(p["dim"], split_factor=p["sf"])
    return Replicate()


def held(shape, mesh, placements, rank):
    dist.init_process_group("fake", store=FakeStore(), rank=rank, world_size=math.prod(mesh))
    try:
        device_mesh = init_device_mesh("cpu", tuple(mesh))
        x = torch.arange(math.prod(shape)).reshape(shape)
        local = distribute_tensor(x, device_mesh, [to_placement(p) for p in placements], src_data_rank=None).to_local()
    finally:
        dist.destroy_process_group()
    values = local.flatten().tolist()
    if len(shape) == 1:
        return [str(v) for v in values], list(local.shape)
    return [f"{v // shape[1]},{v % shape[1]}" for v in values], list(local.shape)


def main():
    levels = json.load(open(sys.argv[1]))
    bad = 0
    for lv in levels:
        for rank, (want, want_shape) in enumerate(zip(lv["target"], lv["local_shapes"])):
            got, got_shape = held(lv["shape"], lv["mesh"], lv["placements"], rank)
            if got != want or got_shape != want_shape:
                bad += 1
                print(f"MISMATCH {lv['title']} rank {rank}: torch {got_shape} {got}, game {want_shape} {want}")
    print(f"{bad} rank mismatches" if bad else f"all {len(levels)} levels match torch distribute_tensor, element order and local shape included")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
