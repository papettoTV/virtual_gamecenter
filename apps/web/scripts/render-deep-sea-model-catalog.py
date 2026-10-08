"""Render encyclopedia icons and create one editable Blender model catalog."""

from pathlib import Path
import argparse
import math
import sys
import bpy
from mathutils import Vector


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "public" / "assets" / "deep-sea-salvage" / "models"
ICON_DIR = PROJECT_ROOT / "public" / "assets" / "deep-sea-salvage" / "encyclopedia"
ICON_DIR.mkdir(parents=True, exist_ok=True)

CREATURES = [
    "sun-sardine", "glass-bream", "ribbon-goby", "blue-puffer", "coral-ray",
    "silver-hatchet", "lantern-cod", "veil-squid", "saw-shrimp", "moon-jelly",
    "abyss-eel", "black-fang", "ghost-squid", "star-mouth", "deep-ray",
    "prism-fish", "crown-jelly", "comet-eel", "ruby-angler", "void-manta", "leviathan",
]
CATALOG_MODELS = CREATURES + ["kelp", "vent", "cliff-detail"]


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(name):
    bpy.ops.import_scene.gltf(filepath=str(MODEL_DIR / f"{name}.glb"))
    roots = [obj for obj in bpy.context.scene.objects if obj.parent is None and obj.type != "CAMERA"]
    root = roots[0] if roots else None
    if root:
        root.name = name
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            for polygon in obj.data.polygons:
                polygon.use_smooth = True
    return root


def scene_bounds():
    points = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        points.extend(obj.matrix_world @ Vector(corner) for corner in obj.bound_box)
    min_x = min(point.x for point in points); max_x = max(point.x for point in points)
    min_z = min(point.z for point in points); max_z = max(point.z for point in points)
    return min_x, max_x, min_z, max_z


def add_lighting_and_camera():
    world = bpy.data.worlds.new("transparent_ocean_world")
    world.color = (0.004, 0.012, 0.022)
    bpy.context.scene.world = world
    camera_data = bpy.data.cameras.new("icon_camera")
    camera = bpy.data.objects.new("icon_camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    # glTF's Y-up model is converted to Blender's Z-up coordinates on import.
    # Looking along +Y reproduces the same side view used by the game camera.
    camera.location = (0, -16, 0)
    camera.rotation_euler = (math.pi / 2, 0, 0)
    camera_data.type = "ORTHO"
    bpy.context.scene.camera = camera
    for name, energy, color, location in [
        ("ocean_key", 850, (0.38, 0.78, 0.95), (-4, 5, 8)),
        ("warm_rim", 600, (0.9, 0.5, 0.22), (5, -3, 6)),
    ]:
        data = bpy.data.lights.new(name, "AREA"); data.energy = energy; data.color = color; data.shape = "DISK"; data.size = 5
        light = bpy.data.objects.new(name, data); bpy.context.scene.collection.objects.link(light); light.location = location
    return camera_data


def render_icon(name):
    clear_scene(); import_glb(name); camera = add_lighting_and_camera()
    min_x, max_x, min_z, max_z = scene_bounds()
    center_x = (min_x + max_x) / 2; center_z = (min_z + max_z) / 2
    bpy.context.scene.camera.location.x = center_x; bpy.context.scene.camera.location.z = center_z
    width = max_x - min_x; height = max_z - min_z
    camera.ortho_scale = max(height * 1.3, width / (640 / 440) * 1.3, .8)
    scene = bpy.context.scene; scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 640; scene.render.resolution_y = 440; scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"; scene.render.film_transparent = True
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.filepath = str(ICON_DIR / f"{name}.png")
    bpy.ops.render.render(write_still=True)
    print(f"rendered {name}")


def build_catalog():
    clear_scene()
    for index, name in enumerate(CATALOG_MODELS):
        root = import_glb(name)
        if root is None:
            continue
        if name == "leviathan":
            root.scale *= .25
        elif name in ("kelp", "vent", "cliff-detail"):
            root.scale *= .65
        root.location.x += (index % 5) * 5.2
        root.location.y += -(index // 5) * 4.3
        root["catalog_label"] = name
    bpy.ops.wm.save_as_mainfile(filepath=str(MODEL_DIR / "deep-sea-model-catalog.blend"))


parser = argparse.ArgumentParser()
parser.add_argument("--asset", action="append", choices=CATALOG_MODELS, help="Render only this asset; may be repeated")
parser.add_argument("--catalog-only", action="store_true", help="Rebuild only the editable Blender catalog")
arguments = parser.parse_args(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
targets = arguments.asset or CATALOG_MODELS
if not arguments.catalog_only:
    for asset in targets:
        render_icon(asset)
if arguments.catalog_only or not arguments.asset:
    build_catalog()
    print("Created encyclopedia renders and deep-sea-model-catalog.blend")
else:
    print(f"Updated {len(targets)} encyclopedia render(s)")
