Speck Sensor
============

A Node.js interface for the CMU CREATE Lab Speck particle sensor.

Installation
================================

Install this module in the usual way:

    npm install speck-sensor
     
Do the following if you want to run this module's tests:

    npm test
        
   You must have a Speck plugged in in order for the tests to pass!

Usage
=====

This module provides a class named `Speck`.  Create a new instance like this:

    var Speck = require('speck-sensor');
    var speck = Speck.create();

For full documentation, generate the JSDocs:

    npm run-script api-docs
    
You'll find the generated docs in the `out` directory.