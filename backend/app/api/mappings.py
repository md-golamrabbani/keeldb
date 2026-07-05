from __future__ import annotations

from fastapi import APIRouter, HTTPException

from ..models import MappingProfile
from ..store import mapping_store

router = APIRouter(prefix="/mappings", tags=["mappings"])


@router.get("", response_model=list[MappingProfile])
def list_mappings():
    return mapping_store.list()


@router.get("/{mapping_id}", response_model=MappingProfile)
def get_mapping(mapping_id: str):
    m = mapping_store.get(mapping_id)
    if not m:
        raise HTTPException(404, "mapping not found")
    return m


@router.post("", response_model=MappingProfile)
def save_mapping(mapping: MappingProfile):
    return mapping_store.save(mapping)


@router.delete("/{mapping_id}")
def delete_mapping(mapping_id: str):
    if not mapping_store.delete(mapping_id):
        raise HTTPException(404, "mapping not found")
    return {"ok": True}
