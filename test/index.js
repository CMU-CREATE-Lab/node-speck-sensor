var expect = require('chai').expect;
var Speck = require('../index');

describe('Speck constructor', function() {
   it("should throw an Error for undefined HID device descriptor", function() {
      expect(function() {
         new Speck()
      }).to.throw(Error);
   });
   it("should throw an Error for null HID device descriptor", function() {
      expect(function() {
         new Speck(null)
      }).to.throw(Error);
   });
   it("should throw an Error for a non-Speck HID device descriptor", function() {
      expect(function() {
         new Speck({})
      }).to.throw(Error);
      expect(function() {
         new Speck("a")
      }).to.throw(Error);
      expect(function() {
         new Speck(1)
      }).to.throw(Error);
      expect(function() {
         new Speck(true)
      }).to.throw(Error);
   });
});

describe('Speck.enumerate()', function() {
   var speckDeviceDescriptors = Speck.enumerate();
   it("should return an array containing at least one Speck device descriptor", function() {
      expect(speckDeviceDescriptors).to.exist;
      expect(speckDeviceDescriptors).to.be.a('Array');
      expect(speckDeviceDescriptors).to.not.be.empty;
   });

   // only test one of them
   var hidDeviceDescriptor = speckDeviceDescriptors[0];
   var speck = null;
   describe('Speck()', function() {
      it("should return a Speck instance when given a valid Speck HID device descriptor", function() {
         speck = new Speck(hidDeviceDescriptor);
         expect(speck).to.exist;
      });
      describe('speck.isConnected()', function() {
         it("should be connected to the Speck hardware", function() {
            expect(speck.isConnected()).to.be.true;
         });
      });
      describe('speck.disconnect()', function() {
         it("should disconnect from the Speck hardware", function() {
            speck.disconnect();
            expect(speck.isConnected()).to.be.false;
         });
      });
   });
});

describe('Speck.create()', function() {
   var speck = null;
   it("should return a Speck instance", function() {
      speck = Speck.create();
      expect(speck).to.exist;
   });
   describe('speck.isConnected()', function() {
      it("should be connected to the Speck hardware", function() {
         expect(speck.isConnected()).to.be.true;
      });
   });
   describe('getSpeckConfig()', function() {
      it('should return the speck config', function(done) {
         speck.getSpeckConfig(function(err, response) {
            expect(err).to.be.null;
            expect(response).to.not.be.null;

            expect(response.id).to.exist;
            expect(response.protocolVersion).to.exist;
            expect(response.loggingIntervalSecs).to.exist;

            done();
         });
      });
   });
   describe('getCurrentSample()', function() {
      it('should return the current sample', function(done) {
         speck.getCurrentSample(function(err, response) {
            expect(err).to.be.null;
            expect(response).to.not.be.null;

            expect(response.sampleTimeSecs).to.exist;
            expect(response.humidity).to.exist;
            expect(response.rawParticleCount).to.exist;

            if (speck.getApiSupport().getProtocolVersion() == 1) {
               expect(response.temperature).to.exist;
            }
            else if (speck.getApiSupport().getProtocolVersion() < 3) {
               expect(response.particleCount).to.exist;
            }
            else {
               expect(response.particleConcentration).to.exist;
            }

            done();
         });
      });
   });
   describe('getSample()', function() {
      it('should return a historic sample', function(done) {
         speck.getSample(function(err, response) {
            expect(err).to.be.null;
            expect(response).to.not.be.null;

            expect(response.sampleTimeSecs).to.exist;
            expect(response.humidity).to.exist;
            expect(response.rawParticleCount).to.exist;

            if (speck.getApiSupport().getProtocolVersion() == 1) {
               expect(response.temperature).to.exist;
            }
            else if (speck.getApiSupport().getProtocolVersion() < 3) {
               expect(response.particleCount).to.exist;
            }
            else {
               expect(response.particleConcentration).to.exist;
            }

            done();
         });
      });
   });
   describe('setLoggingInterval()', function() {
      var currentLoggingInterval = null;
      var desiredLoggingInterval = null;
      before(function(initDone) {
         speck.getSpeckConfig(function(err, config) {
            if (err) {
               return initDone(err);
            }
            currentLoggingInterval = config.loggingIntervalSecs;
            desiredLoggingInterval = (currentLoggingInterval == 10) ? 60 : 10;
            initDone();
         });
      });

      var setAndCheckLoggingInterval = function(desiredLoggingInterval, callback){
         speck.setLoggingInterval(desiredLoggingInterval, function(err, wasSuccessful) {
            expect(err).to.be.null;
            expect(wasSuccessful).to.be.true;

            speck.getSpeckConfig(function(err, config1) {
               if (err) {
                  return callback(err);
               }

               if (config1.loggingIntervalSecs == desiredLoggingInterval) {
                  // now disconnect, then reconnect and re-read the speck config
                  speck.disconnect();
                  speck.connect();

                  speck.getSpeckConfig(function(err, config2) {
                     if (err) {
                        return callback(err);
                     }

                     if (config2.loggingIntervalSecs == desiredLoggingInterval) {
                        callback(null, true);
                     } else {
                        callback(new Error("Incorrect logging interval: expected [" + desiredLoggingInterval + "], got [" + config2.loggingIntervalSecs + "]"));
                     }
                  });
               } else {
                  callback(new Error("Incorrect logging interval: expected [" + desiredLoggingInterval + "], got [" + config1.loggingIntervalSecs + "]"));
               }
            });
         });
      };

      it('should be able to set the logging interval', function(done) {
         console.log("Current logging interval is [" + currentLoggingInterval + "], will change it to [" + desiredLoggingInterval + "]");
         setAndCheckLoggingInterval(desiredLoggingInterval, function(err, wasSuccessful){
            expect(err).to.be.null;
            expect(wasSuccessful).to.be.true;
            done();
         });
      });

      it('should be able to set the logging interval back to what it was before the testing', function(done) {
         console.log("Reverting the logging interval back to [" + currentLoggingInterval + "]");
         setAndCheckLoggingInterval(currentLoggingInterval, function(err, wasSuccessful){
            expect(err).to.be.null;
            expect(wasSuccessful).to.be.true;
            done();
         });
      });
   });
   describe('speck.disconnect()', function() {
      it("should disconnect from the Speck hardware", function() {
         speck.disconnect();
         expect(speck.isConnected()).to.be.false;
      });
   });
});


