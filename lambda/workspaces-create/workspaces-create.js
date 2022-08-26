'use strict';

// Load the AWS SDK for Node.js
var AWS = require('aws-sdk');

// Create the WorkSpaces service object
var workspaces = new AWS.WorkSpaces({
    apiVersion: '2015-04-08'
});

// Create the WorkDocs service object
var workdocs = new AWS.WorkDocs({
    apiVersion: '2016-05-01'
});

// Create the SQS service object
var sqs = new AWS.SQS({apiVersion: '2012-11-05'});

// WorkSpaces must be tied to a Directory Service ID. Creation of the Directory Service is outside the scope of the portal.
// By default, all WorkSpaces are configured with 'Auto Stop' mode with a usage timeout of 1 hour.
var config = {
    Directory: process.env.DIRECTORY_ID || 'd-90672a878e',
    Mode: 'AUTO_STOP',
    UsageTimeout: 60
}

function pwgen(l) {
    if (typeof l==='undefined'){var l=8;}
    /* c : alphanumeric character string */
    var c='abcdefghijknopqrstuvwxyzACDEFGHJKLMNPQRSTUVWXYZ12345679',
    n=c.length,
    /* p : special character string */
    p='!@#$+-*&_',
    o=p.length,
    r='',
    n=c.length,
    /* s : determinate the position of the special character */
    s=Math.floor(Math.random() * (p.length-1));

    for(var i=0; i<l; ++i){
        if(s == i){
            /* special charact insertion (random position s) */
            r += p.charAt(Math.floor(Math.random() * o));
        }else{
            /* alphanumeric insertion */
            r += c.charAt(Math.floor(Math.random() * n));
        }
    }
    return r;
}

function get_registration_code(directory_id){
    var params = {
      DirectoryIds: [
        directory_id
      ],
    };
    var wd_info = workspaces.describeWorkspaceDirectories(params, function(err, data) {
      if (err) console.log(err, err.stack); // an error occurred
      else     console.log("Directory Info:" + data);           // successful response
    });
    return "12345";
}

function queue_write(u, p, i) {
    var sqsURL = process.env.SQS_URL || "https://sqs.eu-west-1.amazonaws.com/420009094734/ws-info-sy"
    var sqsParams = {
      DelaySeconds: 5,
      MessageAttributes: {
        "username": {
          DataType: "String",
          StringValue: u
        },
        "password": {
          DataType: "String",
          StringValue: p
        },
        "workspace-id": {
          DataType: "String",
          StringValue: i
        }
      },
      MessageBody: "workspace user information",
      QueueUrl: sqsURL
    };

    sqs.sendMessage(sqsParams, function(err, data) {
      if (err) {
        console.log("Error", err);
      } else {
        console.log("Success", data.MessageId);
      }
    });
}

exports.handler = (event, context, callback) => {

    // This function is ultimately called if workspaces-control initiates the Step Functions State Machine and the Approver approves creation.
    // Only the State Machine can initiate this function and it cannot be called directly through the API like the other control functions (e.g. reboot).

    // The WorkSpace will be created according to the passed parameters (Email, Username, Bundle ID). The email address will be set as a tag value for the
    // 'SelfServiceManaged' tag. This tag ultimately controls the mapping of users to WorkSpaces from the Portal's perpsective.
    
    var originURL = process.env.ORIGIN_URL || '*';

    console.log("Received event: " + event);

    var requesterEmail = event.split(",")[0];
    var requesterUsername =event.split(",")[1];
    var requesterBundle = event.split(",")[2];

    console.log("Requester email: " + requesterEmail);
    console.log("Requester username: " + requesterUsername);
    console.log("Requester bundle: " + requesterBundle);

    var today = new Date();
    var suffix = today.getDate().toString() + today.getHours().toString() + today.getMinutes().toString();
    var username = requesterUsername + suffix;
    var password = pwgen();
    var uparams = {
      GivenName: 'Workspace', /* required */
      Password: password, /* required */
      Surname: requesterUsername, /* required */
      Username: username, /* required */
      EmailAddress: requesterEmail,
      OrganizationId: config.Directory,
      TimeZoneId: 'UTC'
    };

    var params = {
        Workspaces: [{
            BundleId: requesterBundle,
            DirectoryId: config.Directory,
            UserName: username,
            Tags: [{
                Key: 'SelfServiceManaged',
                Value: requesterEmail
            }, ],
            WorkspaceProperties: {
                RunningMode: config.Mode,
                RunningModeAutoStopTimeoutInMinutes: config.UsageTimeout
            }
        }]
    };
    get_registration_code(config.Directory);
    workdocs.createUser(uparams, function(err, data) {
      if (err) {
          console.log(err, err.stack); // an error occurred
      } else {
        console.log(data);           // successful response
        workspaces.createWorkspaces(params, function (err, data) {
          if (err) {
            console.log("Error: " + err);
            callback(null, {
                statusCode: 500,
                body: JSON.stringify({
                    Error: err,
                }),
                headers: {
                    'Access-Control-Allow-Origin': '*',
                },
            });
          } else {
            console.log("Result: " + JSON.stringify(data));
            queue_write(username, password, data.PendingRequests[0].WorkspaceId);
            callback(null, {
                "statusCode": 200,
                "body": JSON.stringify({
                    "action": "put",
                    "requesterEmailAddress": requesterEmail,
                    "requesterUsername": requesterUsername,
                    "ws_status": "Approved"
                })
            });
          }
        });
      }
    });
};
