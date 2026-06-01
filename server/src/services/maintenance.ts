let databaseMaintenanceActive = false;
let databaseMaintenanceMessage = "数据库维护中，请稍后再试";

export function beginDatabaseMaintenance(message = "数据库维护中，请稍后再试") {
  if (databaseMaintenanceActive) return false;
  databaseMaintenanceActive = true;
  databaseMaintenanceMessage = message;
  return true;
}

export function endDatabaseMaintenance() {
  databaseMaintenanceActive = false;
  databaseMaintenanceMessage = "数据库维护中，请稍后再试";
}

export function isDatabaseMaintenanceActive() {
  return databaseMaintenanceActive;
}

export function getDatabaseMaintenanceMessage() {
  return databaseMaintenanceMessage;
}
