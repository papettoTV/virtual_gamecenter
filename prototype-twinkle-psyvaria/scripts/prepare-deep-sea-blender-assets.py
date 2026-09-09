"""Create editable Blender source files from the generated glTF model assets."""

from pathlib import Path
import bpy


PROJECT_ROOT = Path(__file__).resolve().parents[1]
MODEL_DIR = PROJECT_ROOT / "public" / "assets" / "deep-sea-salvage" / "models"


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_model(name: str):
    source = MODEL_DIR / f"{name}.glb"
    bpy.ops.import_scene.gltf(filepath=str(source))
    roots = [obj for obj in bpy.context.scene.objects if obj.parent is None]
    if roots:
        roots[0].name = name
    for obj in bpy.context.scene.objects:
        if obj.type == "MESH":
            for polygon in obj.data.polygons:
                polygon.use_smooth = True


def add_studio_setup(name: str):
    world = bpy.context.scene.world
    if world is None:
        world = bpy.data.worlds.new("deep_sea_world")
        bpy.context.scene.world = world
    world.color = (0.006, 0.018, 0.028)

    camera_data = bpy.data.cameras.new("preview_camera")
    camera = bpy.data.objects.new("preview_camera", camera_data)
    bpy.context.scene.collection.objects.link(camera)
    camera.location = (0, -10, 3.5)
    camera.rotation_euler = (1.24, 0, 0)
    camera_data.lens = 55
    bpy.context.scene.camera = camera

    key_data = bpy.data.lights.new("ocean_key", "AREA")
    key_data.energy = 900
    key_data.color = (0.32, 0.72, 0.88)
    key_data.shape = "DISK"
    key_data.size = 5
    key = bpy.data.objects.new("ocean_key", key_data)
    bpy.context.scene.collection.objects.link(key)
    key.location = (-4, -4, 6)

    rim_data = bpy.data.lights.new("ocean_rim", "AREA")
    rim_data.energy = 650
    rim_data.color = (0.2, 0.85, 0.72)
    rim_data.size = 3
    rim = bpy.data.objects.new("ocean_rim", rim_data)
    bpy.context.scene.collection.objects.link(rim)
    rim.location = (4, 2, 3)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE_NEXT"
    scene.render.resolution_x = 960
    scene.render.resolution_y = 640
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(MODEL_DIR / f"{name}-blender-preview.png")


def save_editable_model(name: str):
    clear_scene()
    import_model(name)
    add_studio_setup(name)
    bpy.ops.wm.save_as_mainfile(filepath=str(MODEL_DIR / f"{name}.blend"))
    bpy.ops.render.render(write_still=True)


for model_name in ("submarine", "fish"):
    save_editable_model(model_name)

print("Created editable Blender sources and preview renders")
