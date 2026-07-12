UPDATE spot_environment_preferences SET preferred_tide_source='BOM_OFFICIAL' WHERE preferred_tide_source='OFFICIAL';
UPDATE spot_environment_preferences SET preferred_tide_source='EOT20_MODEL' WHERE preferred_tide_source='EOT20';
UPDATE spot_environment_preferences SET preferred_tide_source='NO_TIDE' WHERE preferred_tide_source='NONE';
