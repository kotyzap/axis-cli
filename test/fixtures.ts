/**
 * Recorded VAPIX response bodies from different AXIS OS generations.
 *
 * These are the shapes the parsers have to survive. Each one is either taken
 * from the documented response syntax on developer.axis.com or constructed to
 * reproduce a specific real-world variation — sparse attributes on bundled
 * ACAPs, `nan` axes on a fixed camera, the mixed yes/no-and-true/false booleans
 * Axis itself warns about in the disk listing.
 *
 * The point of testing against fixtures rather than a live camera: the failure
 * modes we care about only appear on firmware we do not have to hand. An M1137
 * on 10.12 cannot be made to answer like a 12.x device, and vice versa.
 */

/** AXIS OS 10.12 on an M1137 — a fixed box camera with digital PTZ. */
export const PARAMS_FW10_M1137 = `root.Brand.Brand=AXIS
root.Brand.ProdFullName=AXIS M1137 Network Camera
root.Brand.ProdNbr=M1137
root.Brand.ProdShortName=AXIS M1137
root.Brand.ProdType=Network Camera
root.Brand.WebURL=http://www.axis.com
root.Properties.API.HTTP.Version=3
root.Properties.API.Metadata.Metadata=yes
root.Properties.API.Metadata.Version=1.00
root.Properties.ApiDiscovery.ApiDiscovery=yes
root.Properties.EmbeddedDevelopment.EmbeddedDevelopment=yes
root.Properties.EmbeddedDevelopment.Version=2.16
root.Properties.Firmware.BuildDate=Feb 14 2024 09:00
root.Properties.Firmware.BuildNumber=338
root.Properties.Firmware.Version=10.12.338
root.Properties.LocalStorage.LocalStorage=yes
root.Properties.LocalStorage.Version=1.00
root.Properties.PTZ.DigitalPTZ=yes
root.Properties.PTZ.PTZ=no
root.Properties.System.Architecture=armv7hf
root.Properties.System.SerialNumber=ACCC8E123456
root.Properties.System.Soc=Axis Artpec-7
root.Network.eth0.IPAddress=192.168.1.156`;

/** AXIS OS 12.11 on a PTZ dome. */
export const PARAMS_FW12_PTZ = `root.Brand.Brand=AXIS
root.Brand.ProdFullName=AXIS Q6135-LE PTZ Network Camera
root.Brand.ProdShortName=AXIS Q6135-LE
root.Properties.API.HTTP.Version=3
root.Properties.API.Metadata.Metadata=yes
root.Properties.ApiDiscovery.ApiDiscovery=yes
root.Properties.EmbeddedDevelopment.Version=4.00
root.Properties.Firmware.Version=12.11.77
root.Properties.FirmwareManagement.Version=1.3
root.Properties.LocalStorage.LocalStorage=yes
root.Properties.PTZ.DigitalPTZ=no
root.Properties.PTZ.PTZ=yes
root.Properties.System.Architecture=aarch64
root.Properties.System.SerialNumber=B8A44F654321`;

/**
 * Firmware 5.51 — an old encoder. No API discovery, no ACAP list support
 * (EmbeddedDevelopment predates 1.20), no basicdeviceinfo.
 */
export const PARAMS_FW5_LEGACY = `root.Brand.Brand=AXIS
root.Brand.ProdFullName=AXIS Q7401 Video Encoder
root.Brand.ProdShortName=AXIS Q7401
root.Properties.API.HTTP.Version=3
root.Properties.EmbeddedDevelopment.Version=1.10
root.Properties.Firmware.Version=5.51.1.1
root.Properties.LocalStorage.LocalStorage=yes
root.Properties.PTZ.PTZ=yes`;

/** param.cgi rejecting a group that does not exist — HTTP 200, error in body. */
export const PARAMS_ERROR = `# Error: Error getting parameter value`;

/** A value that itself contains '=' — must not be truncated. */
export const PARAMS_WITH_EQUALS = `root.Network.Bonjour.FriendlyName=AXIS M1137 - a=b
root.ACAP.Config=key=value&other=thing`;

/**
 * applications/list.cgi from AXIS OS 12, with the full modern attribute set plus
 * nested Resources and CompatibleOsVersions.
 */
export const APPS_FW12_FULL = `<reply result="ok">
<application Name="CamOverlay" NiceName="CamOverlay" Vendor="CamStreamer Ltd." Version="4.2.1"
  Bundled="No" ApplicationID="46396" License="Valid" LicenseExpirationDate="2027-01-01"
  Status="Running" ConfigurationPage="camoverlay/settings.html"
  ValidationResult="https://acap.camstreamer.com/v" SignatureStatus="Signed">
<Resources>
<Resource name="cpu" used="No"/>
</Resources>
<CompatibleOsVersions>
<VersionRange><Min>11.0</Min><Max>12.99</Max></VersionRange>
</CompatibleOsVersions>
</application>
<application Name="AXIS_Object_Analytics" NiceName="AXIS Object Analytics" Vendor="Axis Communications"
  Version="1.10.0" Bundled="Yes" License="None" Status="Running" SignedStatus="Signed"/>
</reply>`;

/**
 * applications/list.cgi from AXIS OS 10 — the sparse case. Note the bundled VMD
 * entry has no NiceName, no Vendor and no License, which is exactly what makes a
 * schema with required fields reject the whole listing.
 */
export const APPS_FW10_SPARSE = `<reply result="ok">
<application Name="CamScripter" NiceName="CamScripter" Vendor="CamStreamer Ltd." Version="1.9.0" Status="Stopped" License="Valid" ApplicationID="46397"/>
<application Name="vmd" Version="4.4-3" Status="Running"/>
<application Name="CamStreamer" NiceName="CamStreamer" Vendor="CamStreamer Ltd." Version="3.9.4" Status="Running" License="Valid"/>
</reply>`;

/** A single application — fast-xml-parser gives an object, not an array. */
export const APPS_SINGLE = `<reply result="ok">
<application Name="CamOverlay" NiceName="CamOverlay" Vendor="CamStreamer Ltd." Version="4.0.0" Status="Running" License="Valid"/>
</reply>`;

export const APPS_NONE = `<reply result="ok">
</reply>`;

/** The documented error envelope: an <error> child element, not an attribute. */
export const APPS_ERROR = `<reply result="error">
<error type="1" message="Error: gdbus call failed" />
</reply>`;

/** What a device with no ACAP support / a proxy in the way can return. */
export const APPS_NOT_XML = `<HTML><HEAD><TITLE>404 Not Found</TITLE></HEAD></HTML>`;

/** info.cgi exactly as documented: plain text sdk elements. */
export const APPS_INFO_SDKS = `<reply result="ok">
<supportedSdks>
<sdk>acap3</sdk>
<sdk>acap4-cv</sdk>
<sdk>acap4-native</sdk>
</supportedSdks>
</reply>`;

/**
 * info.cgi as an AXIS M1137 on 10.12.300 actually answers: the sdk elements
 * carry attributes, so a parser with attribute handling on represents each one as
 * an object rather than a string — and `String(obj)` prints "[object Object]".
 */
export const APPS_INFO_SDKS_WITH_ATTRS = `<reply result="ok">
<supportedSdks>
<sdk version="3.5">acap3</sdk>
<sdk version="1.15">acap4-native</sdk>
</supportedSdks>
</reply>`;

/** A single sdk element — an object, not an array. */
export const APPS_INFO_SDKS_SINGLE = `<reply result="ok">
<supportedSdks><sdk>acap3</sdk></supportedSdks>
</reply>`;

/** No text node at all; the name is only in an attribute. */
export const APPS_INFO_SDKS_ATTR_ONLY = `<reply result="ok">
<supportedSdks>
<sdk name="acap4-native" version="1.15"/>
</supportedSdks>
</reply>`;

export const APP_CONFIG_ALLOW_UNSIGNED_FALSE = `<reply result="ok">
<param name="AllowUnsigned" value="false" />
</reply>`;

/** disks/list.cgi with both an SD card and a network share, mixed boolean styles. */
export const DISKS_SD_AND_SHARE = `<?xml version="1.0" ?>
<root xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <disks numberofdisks="2">
    <disk diskid="SD_DISK" name="My SD Card" totalsize="62522368" freesize="61503488"
      cleanuplevel="95" cleanupmaxage="7" cleanuppolicy="fifo" locked="no" full="no"
      readonly="no" filesystem="ext4" status="OK" group="S0" requiredfilesystem="none"
      diskencryptionenabled="false" diskencrypted="false"/>
    <disk diskid="NetworkShare" name="My Share" totalsize="4194304000" freesize="3670016000"
      locked="no" full="no" readonly="no" filesystem="cifs" status="disconnected" group="S1"/>
  </disks>
</root>`;

/** An empty card slot. */
export const DISKS_EMPTY_SLOT = `<?xml version="1.0" ?>
<root>
  <disks numberofdisks="1">
    <disk diskid="SD_DISK" name="SD Card" totalsize="0" freesize="0" status="disconnected"
      locked="no" full="no" readonly="no" filesystem="" group="S0"/>
  </disks>
</root>`;

/** A single disk — again an object rather than an array. */
export const DISKS_SINGLE = `<?xml version="1.0" ?>
<root><disks numberofdisks="1">
<disk diskid="SD_DISK" name="SD" totalsize="31261184" freesize="15630592" status="OK" filesystem="vfat" locked="no" full="no" readonly="no"/>
</disks></root>`;

export const DISKS_NONE = `<?xml version="1.0" ?>
<root><disks numberofdisks="0"></disks></root>`;

/** A mounted-but-not-"OK" disk. "connected" is an equally valid mounted state. */
export const DISKS_CONNECTED_NOT_OK = `<?xml version="1.0" ?>
<root><disks numberofdisks="1">
<disk diskid="SD_DISK" name="SD" totalsize="31261184" freesize="20000000" status="connected" filesystem="ext4" locked="no" full="no" readonly="no"/>
</disks></root>`;

/** Attribute names in unexpected casing, to prove lookups are case-insensitive. */
export const DISKS_ODD_CASING = `<?xml version="1.0" ?>
<root><disks numberofdisks="1">
<disk DiskID="SD_DISK" Name="SD" TotalSize="1000" FreeSize="400" Status="OK" FileSystem="ext4"/>
</disks></root>`;

/** A device that publishes a LocalStorage Version but has no storage. */
export const PARAMS_FW5_NO_STORAGE = `root.Brand.Brand=AXIS
root.Brand.ProdShortName=AXIS P1204
root.Properties.API.HTTP.Version=3
root.Properties.Firmware.Version=5.55.1.1
root.Properties.LocalStorage.LocalStorage=no
root.Properties.LocalStorage.Version=1.00`;

/**
 * AXIS OS 8.45: basicdeviceinfo.cgi exists (per the parameter) but there is no
 * apidiscovery.cgi yet, which is the only case where the BasicDeviceInfo
 * parameter is the sole evidence for the API.
 */
export const PARAMS_FW8_BDI_PARAM_ONLY = `root.Brand.Brand=AXIS
root.Brand.ProdShortName=AXIS M3045
root.Properties.API.HTTP.Version=3
root.Properties.BasicDeviceInfo.BasicDeviceInfo=yes
root.Properties.EmbeddedDevelopment.Version=2.00
root.Properties.Firmware.Version=8.45.1.1
root.Properties.LocalStorage.LocalStorage=yes`;

/**
 * Attributes sent as nested elements instead. This is the shape that produced
 * "[object Object]" in the Version, Nice-name and Status columns.
 */
export const APPS_NESTED_ELEMENTS = `<reply result="ok">
<application Name="myapp">
<NiceName lang="en">Hello</NiceName>
<Version major="1" minor="20">1.20</Version>
<Status state="Running">Running</Status>
</application>
</reply>`;

/** A text-only <VersionRange> — no usable bounds, so it must be dropped. */
export const APPS_VERSIONRANGE_TEXT = `<reply result="ok">
<application Name="myapp"><CompatibleOsVersions><VersionRange>10.9-12.0</VersionRange></CompatibleOsVersions></application>
</reply>`;

/** Min/Max as attributes rather than child elements. */
export const APPS_VERSIONRANGE_ATTRS = `<reply result="ok">
<application Name="myapp"><CompatibleOsVersions><VersionRange Min="11.0" Max="12.99"/></CompatibleOsVersions></application>
</reply>`;

/** A text-only <error> child, which an attribute-only reader saw as "no error". */
export const APPS_ERROR_TEXT = `<reply result="ok"><error>Access denied</error></reply>`;

/** A disk whose status arrives as a nested element. */
export const DISKS_NESTED_STATUS = `<?xml version="1.0" ?>
<root><disks numberofdisks="1">
<disk diskid="SD_DISK" totalsize="1000" freesize="400"><status code="1">OK</status></disk>
</disks></root>`;

/** A namespaced root — the fixed root.disks.disk path missed this entirely. */
export const DISKS_NAMESPACED = `<?xml version="1.0" ?>
<ns:root xmlns:ns="http://www.axis.com/vapix"><ns:disks numberofdisks="1">
<ns:disk diskid="SD_DISK" totalsize="1000" freesize="400" status="OK"/>
</ns:disks></ns:root>`;

/** No <disks> wrapper at all. */
export const DISKS_NO_WRAPPER = `<?xml version="1.0" ?>
<root><disk diskid="SD_DISK" totalsize="1000" freesize="400" status="OK"/></root>`;

/** Two <disks> blocks — makes the wrapper an array, so the fixed path was undefined. */
export const DISKS_TWO_BLOCKS = `<?xml version="1.0" ?>
<root>
<disks numberofdisks="1"><disk diskid="SD_DISK" totalsize="1000" freesize="400" status="OK"/></disks>
<disks numberofdisks="1"><disk diskid="NetworkShare" totalsize="9000" freesize="9000" status="disconnected"/></disks>
</root>`;

/** A size with a unit suffix. parseInt would read "1.9 GB" as 1 kB. */
export const DISKS_UNIT_SUFFIXED_SIZE = `<?xml version="1.0" ?>
<root><disks numberofdisks="1">
<disk diskid="SD_DISK" totalsize="1.9 GB" freesize="0.5 GB" status="OK"/>
</disks></root>`;

/** basicdeviceinfo.cgi having a bad day: a general internal error, HTTP 200. */
export const BDI_INTERNAL_ERROR = JSON.stringify({
    apiVersion: '1.0',
    context: 'axis-cli',
    error: { code: 8000, message: 'Internal error' },
});

/**
 * com/ptz.cgi?query=position on a real PTZ dome.
 */
export const PTZ_POSITION_FULL = `pan=12.5
tilt=-30.0
zoom=4200
focus=5100
iris=3800
autofocus=on
autoiris=on`;

/**
 * The same query on a fixed camera with digital PTZ. `nan` for the axes it does
 * not have is the behaviour that made the old strict schema fail with
 * "pan: expected number, received nan" instead of reporting no pan axis.
 */
export const PTZ_POSITION_FIXED = `pan=nan
tilt=nan
zoom=1
autofocus=off`;

/** An invalid query — HTTP 200, "Error:" then the message on the next line. */
export const PTZ_ERROR = `Error:
query: unknown value: postion`;

export const PTZ_INFO = `Available commands
:
{camera=[n]}
whoami=yes
center=[x],[y]
  imagewidth=[n]
  imageheight=[n]
areazoom=[x],[y],[z]
  imagewidth=[n]
  imageheight=[n]
zoom=[n]
query={ position | limits }`;

export const PTZ_PRESETS = `presetposno1=Home
presetposno2=Gate
presetposno3=Loading bay`;

/** basicdeviceinfo.cgi getAllProperties on AXIS OS 12. */
export const BDI_SUCCESS = JSON.stringify({
    apiVersion: '1.3',
    context: 'axis-cli',
    data: {
        propertyList: {
            Architecture: 'aarch64',
            Brand: 'AXIS',
            BuildDate: 'Mar 05 2026 11:22',
            HardwareID: '9D3.4',
            ProdFullName: 'AXIS Q6135-LE PTZ Network Camera',
            ProdNbr: 'Q6135-LE',
            ProdShortName: 'AXIS Q6135-LE',
            ProdType: 'PTZ Network Camera',
            SerialNumber: 'B8A44F654321',
            Soc: 'Axis Artpec-8',
            Version: '12.11.77',
            WebURL: 'http://www.axis.com',
        },
    },
});

/** The documented error envelope. Note: HTTP 200, and 2001 means "forbidden". */
export const BDI_FORBIDDEN = JSON.stringify({
    apiVersion: '1.0',
    context: 'axis-cli',
    error: { code: 2001, message: 'Access forbidden' },
});

/** The published error example uses the plural key "apiVersions". */
export const BDI_ERROR_PLURAL_KEY = JSON.stringify({
    apiVersions: '1.0',
    context: 'axis-cli',
    error: { code: 1000, message: 'Property not supported: invalid_property_name' },
});

export const DISCOVERY_FW12 = JSON.stringify({
    apiVersion: '1.0',
    context: 'axis-cli',
    method: 'getApiList',
    data: {
        apiList: [
            { id: 'api-discovery', version: '1.0', status: 'released' },
            { id: 'basic-device-info', version: '1.3', status: 'released' },
            { id: 'event-streaming-over-websocket', version: '1.0', status: 'released' },
            { id: 'ptz-control', version: '1.0', status: 'released' },
            { id: 'fwmgr', version: '1.4', status: 'released' },
        ],
    },
});

/** AXIS OS 9.80: discovery exists but has no WebSocket event streaming. */
export const DISCOVERY_FW9 = JSON.stringify({
    apiVersion: '1.0',
    context: 'axis-cli',
    method: 'getApiList',
    data: {
        apiList: [
            { id: 'api-discovery', version: '1.0', status: 'released' },
            { id: 'basic-device-info', version: '1.1', status: 'released' },
            { id: 'ptz-control', version: '1.0', status: 'released' },
        ],
    },
});

/**
 * A GetEventInstances reply, trimmed but structurally faithful.
 *
 * Contains the two shapes that trip up a naive scan: an ACAP topic whose later
 * segments carry no namespace prefix, and `aev:*` metadata subtrees that describe
 * the message payload rather than contributing path segments.
 */
export const EVENT_INSTANCES = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tns1="http://www.onvif.org/ver10/topics"
  xmlns:tnsaxis="http://www.axis.com/2009/event/topics"
  xmlns:wstop="http://docs.oasis-open.org/wsn/t-1"
  xmlns:aev="http://www.axis.com/vapix/ws/event1">
<s:Body>
<aev:GetEventInstancesResponse>
<wstop:TopicSet>
  <tns1:VideoSource>
    <tnsaxis:DayNightVision wstop:topic="true">
      <aev:MessageInstance>
        <aev:SourceInstance><aev:SimpleItemInstance Name="VideoSourceConfigurationToken"/></aev:SourceInstance>
        <aev:DataInstance><aev:SimpleItemInstance Name="day"/></aev:DataInstance>
      </aev:MessageInstance>
    </tnsaxis:DayNightVision>
  </tns1:VideoSource>
  <tnsaxis:CameraApplicationPlatform>
    <VMD>
      <Camera1ProfileANY wstop:topic="true">
        <aev:MessageInstance>
          <aev:DataInstance><aev:SimpleItemInstance Name="active"/></aev:DataInstance>
        </aev:MessageInstance>
      </Camera1ProfileANY>
    </VMD>
  </tnsaxis:CameraApplicationPlatform>
  <tns1:Device>
    <tnsaxis:IO>
      <VirtualPort wstop:topic="true"/>
    </tnsaxis:IO>
  </tns1:Device>
</wstop:TopicSet>
</aev:GetEventInstancesResponse>
</s:Body>
</s:Envelope>`;

/** Metadata elements under a prefix that is not in the wrapper allow-list. */
export const EVENT_INSTANCES_ODD_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tns1="http://www.onvif.org/ver10/topics"
  xmlns:tnsaxis="http://www.axis.com/2009/event/topics"
  xmlns:wstop="http://docs.oasis-open.org/wsn/t-1"
  xmlns:axsev="http://www.axis.com/vapix/ws/event1">
<s:Body><wstop:TopicSet>
  <tns1:VideoSource>
    <tnsaxis:MotionAlarm wstop:topic="true">
      <axsev:MessageInstance>
        <axsev:DataInstance><axsev:SimpleItemInstance topic="true" Name="active"/></axsev:DataInstance>
      </axsev:MessageInstance>
    </tnsaxis:MotionAlarm>
  </tns1:VideoSource>
</wstop:TopicSet></s:Body>
</s:Envelope>`;

/** The same trap with no namespace prefix on the metadata elements at all. */
export const EVENT_INSTANCES_NO_PREFIX = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
  xmlns:tns1="http://www.onvif.org/ver10/topics"
  xmlns:tnsaxis="http://www.axis.com/2009/event/topics"
  xmlns:wstop="http://docs.oasis-open.org/wsn/t-1">
<s:Body><wstop:TopicSet>
  <tns1:Device>
    <tnsaxis:Status wstop:topic="true">
      <MessageInstance>
        <DataInstance topic="true"/>
      </MessageInstance>
    </tnsaxis:Status>
  </tns1:Device>
</wstop:TopicSet></s:Body>
</s:Envelope>`;

/** control.cgi replies. */
export const CONTROL_OK = 'OK';
export const CONTROL_ALREADY_RUNNING = 'Error: 6';
export const CONTROL_NOT_RUNNING = 'Error: 7';
export const CONTROL_NOT_FOUND = 'Error: 4';
export const UPLOAD_NOT_COMPATIBLE = 'Error: 5';
export const UPLOAD_UNSIGNED = 'Error: 2';
