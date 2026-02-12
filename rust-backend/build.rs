fn main() {
    // Rebuild when the frontend output changes.
    println!("cargo::rerun-if-changed=../app/dist/index.html");

    // Ensure the file exists so `include_str!` doesn't fail during development
    // when the frontend hasn't been built yet.
    let index = std::path::Path::new("../app/dist/index.html");
    if !index.exists() {
        if let Some(parent) = index.parent() {
            std::fs::create_dir_all(parent).ok();
        }
        std::fs::write(
            index,
            "<html><body><p>Frontend not built. Run <code>make build</code>.</p></body></html>",
        )
        .ok();
    }
}
