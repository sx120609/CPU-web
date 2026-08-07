ALTER TABLE `QqBotGroup`
  ADD COLUMN `adFilterWhitelistBlockQrCodeEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `adFilterWhitelistBlockGroupCardEnabled` BOOLEAN NOT NULL DEFAULT false;
