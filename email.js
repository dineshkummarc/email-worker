var CouchDBChanges = require("CouchDBChanges");

var util = require("util");
var nodemailer = require("nodemailer");
var request = require("request");
var url = require("url");

function EmailWorker(config, db) {
  this._config = config;
  // console.warn("EmailWorker running on db: " + db);
  // console.warn("With config: %j", config)

  var follow_options = {
  };

  var changes_options = {
    include_docs: true
    // filter: "email" // TBD!
  };

  var that = this;
  var change_cb = function(error, change) {
    var doc = change.doc;

    if(!doc) {
      console.warn("no doc error wakka wakka");
      return;
    }

    if(error !== null) {
      console.warn("email change_cb caught error: %j", error);
      // todo report error
      return;
    }

    if(doc.type && doc.type !== "$email") {
      console.warn("not an email doc, ignoring. fix server filter!");
      return;
    }

    if(!doc.to) {
      console.warn("empty or no 'to' field, ignoring.");
      // set error actually
      return;
    }

    if(!doc.to.match(/@/)) {
      console.warn("invalid 'to' field, ignoring.");
      // set error actually
      return;
    }

    if(doc.error || doc.delivered_at) {
      console.warn("we did try sending this once, ignoring.");
      return;
    }

    // console.warn("change: %j", change);

    var db2email = function(db) {
      return db.replace(/_/g, ".").replace(/\$/, "@");
    };

    // send!
    that._doSend(db2email(db), doc, {
      success: function() {
        // yay
        doc.delivered_at = new Date().toJSON();
        that._doSaveDoc(db, doc);
      },
      error: function(error) {
        // nooooo
        doc.error = error;
        that._doSaveDoc(db, doc);
      }
    });
  };

  var changes = new CouchDBChanges(config);
  changes.follow(db, change_cb, follow_options, changes_options);
}

EmailWorker.prototype._doSend = function(from, email, callbacks) {
  //send email
  // create reusable transport method (opens pool of SMTP connections)
  var transport_config = {
    host: this._config.email.host,
    port: 465,
    auth: {
      user: this._config.email.auth.user,
      pass: this._config.email.auth.pass
    },
    secureConnection: true,
	service: this._config.email.service
  };
  var smtpTransport = nodemailer.createTransport("SMTP", transport_config);

  // setup e-mail data with unicode symbols
  email.from = from;
  // send mail with defined transport object
  smtpTransport.sendMail(email, function(error, response){
    if(error) {
      if(callbacks.error) {
        console.log("Mail note sent: " + error);
        callbacks.error(error);
      }
    } else {
      if(callbacks.success) {
        callbacks.success(response);
      }
    }
    smtpTransport.close(); // shut down the connection pool, no more messages
  });
}

EmailWorker.prototype._doSaveDoc = function(db, doc) {
  var uri = url.parse(this._config.server);
  uri.path = "/" + db + "/" + doc._id.replace(/\//, "%2f") + "?rev=" + doc._rev;
  uri.auth = this._config.admin.user + ":" + this._config.admin.pass;
  delete doc._id;
  delete doc.transport;
  request({
    uri: uri,
    method: "PUT",
    json: doc
  }, function(error, response) {
    if(error) {
      console.warn("Set Doc status fail: " + error);
    }
    // console.warn("Save doc response: %j", response.body);
  });
}

var config = {
  server: process.env["CANG_SERVER"],
  admin: {
    user: process.env["CANG_ADMIN_USER"],
    pass: process.env["CANG_ADMIN_PASS"]
  },
  email: {
    service: process.env["CANG_EMAIL_SERVICE"],
    host: process.env["CANG_EMAIL_HOST"],
    auth: {
      user: process.env["CANG_EMAIL_USER"],
      pass: process.env["CANG_EMAIL_PASS"]
    }
  }
};

var workers = [];
request({
  uri: config.server + "/_all_dbs"
}, function(error, response, body) {
  if(error !== null) {
    console.warn("init error, _all_dbs: " + error);
  }

  var dbs = JSON.parse(body);
  dbs.forEach(function(db) {
    var worker = new EmailWorker(config, db);
    workers.push(worker);
  });
});

var http = require('http');
http.createServer(function (req, res) {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Hello Workers:\n ' + workers.length);
}).listen(process.env["PORT"], '0.0.0.0');
console.log('Server running at http://0.0.0.0:' + process.env["PORT"]);
