var HID = require('node-hid');
var ByteBuffer = require('byte');
var log = require('log4js').getLogger("speck-sensor");

var SPECK_HID = {
   "vendorId" : 0x2354,
   "productId" : 0x3333
};

//======================================================================================================================
// HELPER FUNCTIONS
//======================================================================================================================

var isSpeck = function(hidDeviceDescriptor) {
   if (typeof hidDeviceDescriptor !== 'object' || hidDeviceDescriptor == null) {
      return false;
   }

   // check each property
   for (var property in SPECK_HID) {
      if (SPECK_HID[property] != hidDeviceDescriptor[property]) {
         return false;
      }
   }

   // make sure there's a "path" property, too!
   if (!hidDeviceDescriptor.hasOwnProperty('path')) {
      return false
   }

   // if all the properties match, then we found a Speck!
   return true;
};

// Returns a random integer between min (included) and max (excluded)
// Using Math.round() will give you a non-uniform distribution!
// Got this from: https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/random
var getRandomInt = function(min, max) {
   return Math.floor(Math.random() * (max - min)) + min;
};

//======================================================================================================================
// CLASS DEFINITION
//======================================================================================================================

/**
 * <p>
 *    Creates a Speck instance using the given HID device descriptor and automatically attempts a connection.  You can
 *    obtain the HID device descriptor by calling {@linkcode Speck.enumerate}.
 * </p>
 * <p>
 *    Throws an <code>Error</code> if the HID device descriptor argument is <code>undefined</code> or <code>null</code>,
 *    or does not appear to be a valid device descriptor, or if a connection could not be established.
 * </p>
 * <p>
 *    Note that, in most cases, it is easier to simply call {@linkcode Speck.create} to create a new instance.
 * </p>
 *
 * @param {object} hidDeviceDescriptor - an HID device descriptor
 * @constructor
 * @throws {Error} if the HID device descriptor is <code>undefined</code>, <code>null</code>, or invalid
 * @throws {Error} if a connection to the hardware could not be established.
 * @see Speck.create
 * @see Speck.enumerate
 */
function Speck(hidDeviceDescriptor) {
   var GET_INFO_COMMAND_CHARACTER = "I";
   var GET_EXTENDED_INFO_COMMAND_CHARACTER = "i";
   var GET_HISTORIC_SAMPLE_COMMAND_CHARACTER = "G";
   var GET_CURRENT_SAMPLE_COMMAND_CHARACTER = "S";
   var GET_SAMPLE_COUNT_COMMAND_CHARACTER = "P";
   var SET_LOGGING_INTERVAL_COMMAND_CHARACTER = "I";

   var REPORT_ID = 1;
   var COMMAND_LENGTH_IN_BYTES = 16;

   // Array index in the data byte array containing the checksum byte
   var CHECKSUM_BYTE_INDEX = COMMAND_LENGTH_IN_BYTES - 2;

   // Array index in the data byte array containing the command ID byte
   var COMMAND_ID_BYTE_INDEX = COMMAND_LENGTH_IN_BYTES - 1;

   // Byte indices for Info command
   var SERIAL_NUMBER_STARTING_BYTE_INDEX = 1;
   var SERIAL_NUMBER_BYTE_ENDING_BYTE_INDEX_PROTOCOL_1_AND_2 = 10;
   var SERIAL_NUMBER_BYTE_ENDING_BYTE_INDEX_PROTOCOL_3 = 8;
   var HARDWARE_VERSION_BYTE_INDEX = 10;
   var PROTOCOL_VERSION_BYTE_INDEX = 11;
   var LOGGING_INTERVAL_BYTE_INDEX_WHEN_READING = 12;
   var FIRMWARE_VERSION_BYTE_INDEX = 13;

   // Byte indices for Num Samples command
   var NUM_SAMPLES_BYTE_INDEX = 1;

   // Byte indices for Get Data Sample command
   var SAMPLE_TIME_SECS_BYTE_INDEX = 1;
   var PARTICLE_COUNT_OR_CONCENTRATION_BYTE_INDEX = 5;
   var TEMPERATURE_BYTE_INDEX = 9;
   var HUMIDITY_BYTE_INDEX = 11;
   var RAW_PARTICLE_COUNT_BYTE_INDEX = 12;

   // Byte indices for Set Logging Interval command
   var LOGGING_INTERVAL_BYTE_INDEX_WHEN_WRITING = 5;

   var DEFAULT_LOGGING_INTERVAL = 1;
   var MIN_LOGGING_INTERVAL = 1;
   var MAX_LOGGING_INTERVAL = 255;

   if (!isSpeck(hidDeviceDescriptor)) {
      throw new Error("The given hidDeviceDescriptor does not represent a Speck!");
   }

   var self = this;
   var speck = null;
   var speckConfig = null;
   var commandId = getRandomInt(1, 256);  // start with a random command ID in the range [1,255]

   var commandQueue = [];

   /**
    * Establishes a connection to the Speck hardware.  This is called automatically by this class's constructor. Does
    * nothing if already {@link Speck#isConnected connected}.  Returns whether the connection was successful.
    *
    * @returns {boolean} - whether the connection was successful
    * @see {@link Speck#isConnected isConnected}
    */
   this.connect = function() {

      if (speck == null) {
         // Attempt to connect to the hardware
         try {
            speck = new HID.HID(hidDeviceDescriptor.path);
            // call getSpeckConfig here just so it's cached for future use
            this.getSpeckConfig(function(err, config) {
               if (err) {
                  log.error("connect(): Failed to get speck config after successful connection!");
                  throw err;
               }
            })
         }
         catch (e) {
            log.error("connect(): connection failed: " + e);
            speck = null;
         }
      }

      return speck ? this.isConnected() : false;
   };

   /**
    * Disconnects from the Speck hardware.  Does nothing if already {@link Speck#isConnected disconnected}.  To
    * attempt a reconnection, call {@linkcode Speck#connect connect}.
    *
    * @see {@link Speck#isConnected isConnected}
    * @see {@link Speck#connect connect}
    */
   this.disconnect = function() {
      if (speck != null) {
         try {
            speck.close();
         }
         catch (e) {
            log.error("disconnect(): exception while closing connection with the Speck: " + e);
         }
         finally {
            speck = null;
            speckConfig = null;
         }
      }
   };

   /**
    * Returns <code>true</code> if connected to a Speck, <code>false</code> otherwise.
    *
    * @returns {boolean}
    */
   this.isConnected = function() {
      return speck != null;
   };

   /**
    * <p>
    *    Returns various properties about the currently-connected Speck to the given callback function.  These values
    *    are read once then cached for future use.  The version returned here is a copy of the cached version, so
    *    modifications won't have any effect on the cached version.
    * </p>
    * <p>
    *    The returned data object contains the following fields:
    *    <ul>
    *       <li><code>id</code>: string</li>
    *       <li><code>protocolVersion</code>: integer</li>
    *       <li><code>loggingIntervalSecs</code>: integer</li>
    *       <li><code>firmwareVersion</code>: integer (only in Specks supporting protocol version 3 or later)</li>
    *       <li><code>hardwareVersion</code>: integer (only in Specks supporting protocol version 3 or later)</li>
    *    </ul>
    * </p>
    *
    * @param callback {function} - the callback function with a signature of the form <code>callback(err, data)</code>
    */
   this.getSpeckConfig = function(callback) {
      if (typeof callback === 'function') {
         if (speckConfig) {
            log.debug("getSpeckConfig(): returning copy of cached version");
            return callback(null, simpleObjectCopy(speckConfig));
         }
         else {
            log.debug("getSpeckConfig(): querying hardware for speck config");
            getBasicSpeckConfig(function(err, config) {
               if (err) {
                  return callback(err, null);
               }

               speckConfig = config;

               if (speckConfig.protocolVersion < 3) {
                  return callback(null, simpleObjectCopy(speckConfig));
               }

               log.debug("getSpeckConfig(): need to get extended Speck config");
               getExtendedSpeckConfig(function(err2, extendedConfig) {
                  if (err2) {
                     return callback(err2, null);
                  }

                  log.debug("getSpeckConfig(): id was [" + speckConfig.id + "]");
                  speckConfig.id = speckConfig.id + extendedConfig.id;
                  log.debug("getSpeckConfig(): id is now [" + speckConfig.id + "]");

                  callback(null, simpleObjectCopy(speckConfig));
               });
            })
         }
      }
      else {
         log.error("Given callback [" + callback + "] is not a function")
      }
   };

   var getBasicSpeckConfig = function(callback) {
      if (self.isConnected()) {
         var command = createCommand(GET_INFO_COMMAND_CHARACTER);
         enqueueCommand(command, function(err, data) {
            if (err) {
               log.error("getSpeckConfig(): failed to get Speck config: " + err);
               callback(err, null);
            }
            else {
               if (data) {
                  // First, get the protocol version number
                  var protocolVersion = data.readUInt8(PROTOCOL_VERSION_BYTE_INDEX);

                  // Protocol 1 and 2 have a 10-byte serial number.  Protocol three has a 16-byte serial number, split
                  // into two groups of 8.  One here, and the other in the 'i' command.
                  var serialNumberEndingByteIndex = (protocolVersion < 3) ?
                                                    SERIAL_NUMBER_BYTE_ENDING_BYTE_INDEX_PROTOCOL_1_AND_2 :
                                                    SERIAL_NUMBER_BYTE_ENDING_BYTE_INDEX_PROTOCOL_3;

                  // Construct the serial number:
                  // 1) convert the data buffer to a decimal array
                  // 2) call slice on it to pick out just the 10 bytes which make up the ID
                  // 3) call map on that to turn each value into a zero-padded hex string
                  // 4) then finally join it all up with no delimiter to create the serial number string.
                  var serialNumber =
                        data.toJSON()
                              .slice(SERIAL_NUMBER_STARTING_BYTE_INDEX, serialNumberEndingByteIndex + 1)
                              .map(byteToZeroPaddedHexString)
                              .join('');

                  // build the return object
                  var obj = {
                     id : serialNumber,
                     protocolVersion : protocolVersion,
                     loggingIntervalSecs : data.readUInt8(LOGGING_INTERVAL_BYTE_INDEX_WHEN_READING)
                  };

                  // Logging interval was introduced in protocol version 2. In prior versions, it was hardcoded to 1 second
                  if (protocolVersion < 2) {
                     obj.loggingIntervalSecs = DEFAULT_LOGGING_INTERVAL;
                  }

                  // Protocol 3 introduced hardware and firmware version
                  if (protocolVersion >= 3) {
                     obj.firmwareVersion = data.readUInt8(FIRMWARE_VERSION_BYTE_INDEX);
                     obj.hardwareVersion = data.readUInt8(HARDWARE_VERSION_BYTE_INDEX);
                  }

                  callback(null, obj);
               }
               else {
                  log.error("getSpeckConfig(): no data in the response!");
                  callback(null, null);
               }
            }
         });
      }
      else {
         callback(new Error("Not connected to a Speck!"), null);
      }
   };

   var getExtendedSpeckConfig = function(callback) {
      if (self.isConnected()) {
         var command = createCommand(GET_EXTENDED_INFO_COMMAND_CHARACTER);
         enqueueCommand(command, function(err, data) {
            if (err) {
               log.error("getExtendedSpeckConfig(): failed to get extended Speck config: " + err);
               callback(err, null);
            }
            else {
               if (data) {
                  // Construct the serial number suffix:
                  // 1) convert the data buffer to a decimal array
                  // 2) call slice on it to pick out just the 10 bytes which make up the ID
                  // 3) call map on that to turn each value into a zero-padded hex string
                  // 4) then finally join it all up with no delimiter to create the serial number string.
                  var serialNumberSuffix =
                        data.toJSON()
                              .slice(SERIAL_NUMBER_STARTING_BYTE_INDEX, SERIAL_NUMBER_BYTE_ENDING_BYTE_INDEX_PROTOCOL_3 + 1)
                              .map(byteToZeroPaddedHexString)
                              .join('');

                  callback(null, {id : serialNumberSuffix});
               }
               else {
                  log.error("getExtendedSpeckConfig(): no data in the response!");
                  callback(null, null);
               }
            }
         });
      }
      else {
         callback(new Error("Not connected to a Speck!"), null);
      }
   };

   this.getApiSupport = function() {
      return {
         getProtocolVersion : function() {
            return speckConfig.protocolVersion;
         },
         canMutateLoggingInterval : function() {
            return speckConfig.protocolVersion >= 2;
         },
         canGetNumberOfDataSamples : function() {
            return speckConfig.protocolVersion >= 2;
         },
         hasTemperatureSensor : function() {
            return speckConfig.protocolVersion <= 1;
         },
         hasParticleCount : function() {
            return speckConfig.protocolVersion <= 2;
         },
         hasParticleConcentration : function() {
            return speckConfig.protocolVersion >= 3;
         },
         hasDeviceVersionInfo : function() {
            return speckConfig.protocolVersion >= 3;
         },
         hasExtendedId : function() {
            return speckConfig.protocolVersion >= 3;
         },
         canEnterBootloaderMode : function() {
            return speckConfig.protocolVersion >= 2;
         }
      };
   };

   /**
    * <p>
    *    Reads the current sample from the Speck and returns the it to the given <code>callback</code>.  The callback
    *    function has a signature of the form <code>callback(err, data)</code>.
    * </p>
    * <p>
    *    For The data object contains the following fields:
    *    <ul>
    *       <li><code>sampleTimeSecs</code>: integer</li>
    *       <li><code>particleCount</code>: integer (only included in Specks supporting protocol version 1 or 2)</li>
    *       <li><code>particleConcentration</code>: integer (only included in Specks supporting protocol version 3)</li>
    *       <li><code>humidity</code>: integer</li>
    *       <li><code>rawParticleCount</code>: integer</li>
    *       <li><code>temperature</code>: integer (only included in Specks supporting protocol version 1)</li>
    *    </ul>
    * </p>
    *
    * @param callback {function} - the callback function with a signature of the form <code>callback(err, data)</code>
    */
   this.getCurrentSample = function(callback) {
      getDataSample(GET_CURRENT_SAMPLE_COMMAND_CHARACTER, callback);
   };

   /**
    * <p>
    *    Reads the historical sample from the Speck and returns the it to the given <code>callback</code>.  The callback
    *    function has a signature of the form <code>callback(err, data)</code>.
    * </p>
    * <p>
    *    The data object contains the following fields:
    *    <ul>
    *       <li><code>sampleTimeSecs</code>: integer</li>
    *       <li><code>particleCount</code>: integer (only included in Specks supporting protocol version 1 or 2)</li>
    *       <li><code>particleConcentration</code>: integer (only included in Specks supporting protocol version 3)</li>
    *       <li><code>humidity</code>: integer</li>
    *       <li><code>rawParticleCount</code>: integer</li>
    *       <li><code>temperature</code>: integer (only included in Specks supporting protocol version 1)</li>
    *    </ul>
    * </p>
    * <p>
    *    The error and data objects will both be <code>null</code> if no historical data is available.
    * </p>
    *
    * @param callback {function} - the callback function with a signature of the form <code>callback(err, data)</code>
    */
   this.getSample = function(callback) {
      getDataSample(GET_HISTORIC_SAMPLE_COMMAND_CHARACTER, callback);
   };

   var getDataSample = function(commandCharacter, callback) {
      if (self.isConnected()) {
         var command = createCommand(commandCharacter);
         enqueueCommand(command, function(err, data) {
            if (err) {
               log.error("getDataSample(): failed to get data sample: " + err);
               callback(err, null);
            }
            else {
               if (data) {
                  // build the return object
                  var obj = {
                     sampleTimeSecs : data.readUInt32BE(SAMPLE_TIME_SECS_BYTE_INDEX),
                     humidity : data.readUInt8(HUMIDITY_BYTE_INDEX),
                     rawParticleCount : data.readUInt16BE(RAW_PARTICLE_COUNT_BYTE_INDEX)
                  };

                  // see whether any data was actually returned (timestamp should never be 0)
                  var isNoDataAvailable = obj.sampleTimeSecs == 0;

                  if (!isNoDataAvailable) {
                     // temperature was only included in protocol version 1
                     if (self.getApiSupport().hasTemperatureSensor()) {
                        obj['temperature'] = data.readUInt16BE(TEMPERATURE_BYTE_INDEX);
                     }

                     // add the particleCount or particleConcentration field, depending on the protocol version.
                     var particleCountOrConcentration = data.readUInt32BE(PARTICLE_COUNT_OR_CONCENTRATION_BYTE_INDEX);
                     if (self.getApiSupport().hasParticleCount()) {
                        obj['particleCount'] = particleCountOrConcentration;
                     }
                     else {
                        obj['particleConcentration'] = particleCountOrConcentration / 10.0;
                     }
                  }

                  // return null if no data is available
                  callback(null, isNoDataAvailable ? null : obj);
               }
               else {
                  log.error("getDataSample(): no data in the response!");
                  callback(new Error("No data in the response"), null);
               }
            }
         });
      }
      else {
         callback(new Error("Not connected to a Speck!"), null);
      }
   };

   this.getNumberOfAvailableSamples = function(callback) {
      if (self.isConnected()) {
         if (!self.getApiSupport().canGetNumberOfDataSamples()) {
            return callback(new Error("This Speck cannot report the number of available samples."), null);
         }

         var command = createCommand(GET_SAMPLE_COUNT_COMMAND_CHARACTER);
         enqueueCommand(command, function(err, data) {
            if (err) {
               log.error("getNumberOfAvailableSamples(): failed to get number of data samples: " + err);
               callback(err, null);
            }
            else {
               if (data) {
                  // build the return object
                  var obj = {
                     numSamples : data.readUInt32BE(NUM_SAMPLES_BYTE_INDEX)
                  };

                  callback(null, obj);
               }
               else {
                  log.error("getNumberOfAvailableSamples(): no data in the response!");
                  callback(null, null);
               }
            }
         });
      }
      else {
         callback(new Error("Not connected to a Speck!"), null);
      }
   };

   this.deleteSample = function(sampleTime, callback) {
      // TODO: implement me!
   };

   /**
    * Sets the logging interval, if supported by the Speck's firmware. The given
    * <code>loggingIntervalInSeconds</code> is clamped to ensure it's within the valid range.
    *
    * @param {int} loggingIntervalInSeconds
    * @param callback
    */
   this.setLoggingInterval = function(loggingIntervalInSeconds, callback) {
      if (self.isConnected()) {
         if (self.getApiSupport().canMutateLoggingInterval()) {
            // make sure the range is valid
            loggingIntervalInSeconds = Math.min(Math.max(loggingIntervalInSeconds, MIN_LOGGING_INTERVAL), MAX_LOGGING_INTERVAL);

            var command = createCommand(SET_LOGGING_INTERVAL_COMMAND_CHARACTER);
            command[LOGGING_INTERVAL_BYTE_INDEX_WHEN_WRITING] = loggingIntervalInSeconds;
            enqueueCommand(command, function(err, data) {
               if (err) {
                  console.log("ERROR: setLoggingInterval(): failed to write logging interval: " + err);
                  callback(err, null);
               }
               else {
                  if (data) {
                     // read the value returned from the Speck and make sure it matches the value we asked for
                     var actualLoggingInterval = data.readUInt8(LOGGING_INTERVAL_BYTE_INDEX_WHEN_READING);
                     var wasSuccessful = loggingIntervalInSeconds == actualLoggingInterval;
                     if (wasSuccessful) {
                        // remember this new logging interval
                        speckConfig.loggingIntervalSecs = actualLoggingInterval;
                     }
                     else {
                        console.log("ERROR: Failed to set logging interval. Expected [" + loggingIntervalInSeconds + "], but received [" + actualLoggingInterval + "]");
                     }
                     callback(null, wasSuccessful);
                  }
                  else {
                     console.log("ERROR: setLoggingInterval(): no data in the response!");
                     callback(null, false);
                  }
               }
            });
         }
         else {
            return callback(new Error("The logging interval for this Speck cannot be modified."), null);
         }
      }
      else {
         callback(new Error("Not connected to a Speck!"), null);
      }
   };

   var createCommand = function(commandCharacter) {
      var byteBuffer = ByteBuffer.allocate(COMMAND_LENGTH_IN_BYTES);

      // for some reason, these buffers have random bytes in them, so initialize to all zeros
      for (var i = 0; i < COMMAND_LENGTH_IN_BYTES; i++) {
         byteBuffer.putChar(0);
      }
      byteBuffer.position(0);    // resets the write position

      byteBuffer.putChar(commandCharacter);                                   // the command character
      byteBuffer.putInt(Math.round(new Date().getTime() / 1000));             // current time in seconds

      // convert to an array and return
      return byteBufferToArray(byteBuffer, COMMAND_LENGTH_IN_BYTES);
   };

   var computeChecksum = function(command) {
      // Speck checksum simply sums all the bytes and then uses the lowest 8 bits
      var sum = 0;
      for (var i = 0; i < CHECKSUM_BYTE_INDEX; i++) {
         sum += command[i];
      }

      return sum & 0xff;
   };

   var enqueueCommand = function(command, callback) {

      // define the command queue processor
      var processCommandQueue = function() {
         if (commandQueue.length > 0) {

            var shiftQueueAndContinue = function() {
               commandQueue.shift();
               processCommandQueue();
            };

            // peek at the item in need of processing
            var commandQueueItem = commandQueue[0];

            // attempt to write the command
            try {

               speck.sendFeatureReport(commandQueueItem.command);

               // now attempt to read the response
               try {
                  var data = speck.getFeatureReport(REPORT_ID, COMMAND_LENGTH_IN_BYTES);
                  data = new Buffer(data);
                  if (data) {
                     // verify command ID and checksum
                     var responseData = data.toJSON();

                     var expectedCommandId = commandQueueItem.command[COMMAND_ID_BYTE_INDEX];
                     var actualCommandId = responseData[COMMAND_ID_BYTE_INDEX];
                     if (expectedCommandId == actualCommandId) {
                        var expectedChecksum = computeChecksum(responseData);
                        var actualChecksum = responseData[CHECKSUM_BYTE_INDEX];
                        if (expectedChecksum == actualChecksum) {
                           commandQueueItem.callback(null, data);
                        }
                        else {
                           commandQueueItem.callback(new Error("Failed to read response: invalid checksum.  Expected [" + expectedChecksum + "] actual [" + actualChecksum + "]"), null);
                        }
                     }
                     else {
                        commandQueueItem.callback(new Error("Failed to read response: invalid command ID.  Expected [" + expectedCommandId + "] actual [" + actualCommandId + "]"), null);
                     }
                  }
                  else {
                     commandQueueItem.callback(new Error("Failed to read response: no data"), null);
                  }
                  shiftQueueAndContinue();
               }
               catch (readError) {
                  log.error("processCommandQueue(): failed to read command response: " + readError);
                  commandQueueItem.callback(readError, null);

                  shiftQueueAndContinue();
               }
            }
            catch (writeError) {
               log.error("processCommandQueue(): failed to write command: " + writeError);
               commandQueueItem.callback(writeError, null);

               shiftQueueAndContinue();
            }
         }
      };

      // commands need incrementing command IDs
      command[COMMAND_ID_BYTE_INDEX] = getNextCommandId();

      // insert checksum
      command[CHECKSUM_BYTE_INDEX] = computeChecksum(command);       // insert the checksum

      var commandQueueItem = {
         command : command,
         callback : callback,

         time : new Date().getTime(),
         toString : function() {
            return "commandQueueItem: t=[" + this.time + "], command=[" + command.map(byteToZeroPaddedHexString).join() + "]"
         }
      };

      //log.debug("enqueueCommand: enqueuing " + commandQueueItem.toString());
      commandQueue.push(commandQueueItem);

      // If this newly-added item is the only thing on the command queue, then go ahead and kick off processing.
      // Otherwise, the command queue processor must already be running, so this new item will get processed
      if (commandQueue.length <= 1) {
         processCommandQueue();
      }
   };

   var getNextCommandId = function() {
      commandId++;
      if (commandId > 255) {
         commandId = 1;
      }
      return commandId;
   };

   var byteBufferToArray = function(byteBuffer, desiredArrayLength) {
      byteBuffer.position(desiredArrayLength);
      var buffer = byteBuffer.array(0, desiredArrayLength);
      return buffer.toJSON();
   };

   // convert a byte to a zero-padded hex string (from http://stackoverflow.com/a/1283519/703200)
   var byteToZeroPaddedHexString = function(val) {
      return ("00" + (val).toString(16)).slice(-2);
   };

   var simpleObjectCopy = function(obj) {
      var objCopy = {};
      for (var i in obj) {
         objCopy[i] = obj[i];
      }
      return objCopy;
   };

   // the "constructor"
   (function() {
      if (!self.connect()) {
         throw new Error("Connection failed: failed to connect to device at path [" + hidDeviceDescriptor.path + "]");
      }
   })();
}

//======================================================================================================================
// PUBLIC STATIC METHODS
//======================================================================================================================

/**
 * Scans for Speck devices and creates and returns a new instance of a {@link Speck} representing the first Speck to
 * which it could successfully connect. Returns <code>null</code> if no Specks are plugged in or if a connection could
 * not be established to any Speck.
 *
 * @returns {Speck}
 * @see Speck
 */
Speck.create = function() {
   var hidDeviceDescriptors = Speck.enumerate();
   for (var i = 0; i < hidDeviceDescriptors.length; i++) {
      var hidDeviceDescriptor = hidDeviceDescriptors[i];
      try {
         return new Speck(hidDeviceDescriptor);
      }
      catch (e) {
         log.error("Speck.create(): failed to connect to speck at path [" + hidDeviceDescriptor.path + "] due to error:" + e);
      }
   }

   return null;
};

/**
 * Returns an array of HID device descriptor objects for all plugged-in Specks.  Returns an empty array if no Specks are
 * plugged in.  Note that this method makes no guarantees about availability.  A device may currently be in use by
 * another process.  The only way to determine availability is to attempt a connection.
 *
 * @returns {Array}
 * @see Speck.enumerate
 */
Speck.enumerate = function() {
   return HID.devices(SPECK_HID.vendorId, SPECK_HID.productId);
};

//======================================================================================================================

module.exports = Speck;