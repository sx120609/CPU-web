export function deploymentChildEnvironment(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result = { ...source };
  // Runtime PORT is the active blue/green slot, not the deployment's base port.
  if (source.CPU_WEB_DEPLOY_BASE_PORT) result.PORT = source.CPU_WEB_DEPLOY_BASE_PORT;
  if (source.CPU_WEB_DEPLOY_VOICE_PORT) result.VOICEHUB_PORT = source.CPU_WEB_DEPLOY_VOICE_PORT;
  delete result.CPU_WEB_UPDATE_LOCKED;
  delete result.CPU_WEB_UPDATE_REEXEC;
  delete result.DEPLOY_FORCE_ALL;
  delete result.DEPLOY_ALLOW_SCHEMA_EXPAND;
  delete result.DEPLOY_TARGET_COMMIT;
  delete result.DEPLOY_CHANGED_FILES;
  delete result.DEPLOY_ARTIFACT_DIR;
  return { ...result, CPU_WEB_ADMIN_DEPLOY: "1" };
}
