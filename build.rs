fn main() {
    #[cfg(not(debug_assertions))]
    embed_resource::compile("jonitor.rc", embed_resource::NONE);
}
