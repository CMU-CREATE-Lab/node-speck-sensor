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
   describe('speck.disconnect()', function() {
      it("should disconnect from the Speck hardware", function() {
         speck.disconnect();
         expect(speck.isConnected()).to.be.false;
      });
   });
});


