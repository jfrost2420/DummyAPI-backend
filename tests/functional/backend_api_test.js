var should = require('should');
var _ = require('underscore');
var async = require('async');
var app_clients = require('../../app/app_clients');


var APPLICATION_NAME = "___Test__Application___";
var bclient = new app_clients.BackendClient();

describe('Backend Configuration API', function () {

  var application = null;

  before(function (done) {

    async.series([
      function (done) {
        bclient.createApp(APPLICATION_NAME, function (response) {
          application = response.content.data;
          done();
        });
      }
    ],
    function () {
      done();
    });


  });

  after(function (done) {
    bclient.deleteApp(application.id, function (response) {
      done();
    });
  });

  /* Application manipulations */
  it('should have created application', function () {
    application.should.have.property('access_token');
    application.should.have.property('name');
    application.should.have.property('object_types');
  });

  it('should renew application access token', function (done) {

    async.series([
      function (done) {
        bclient.renewAppAccessToken(application.id, function (response) {
          response.content.data.should.have.property('access_token');

          application.access_token = response.content.data.access_token;
          done();
        });
      },

      function (done) {
        bclient.getApplication(application.id, function (response) {
          response.content.data.should.have.property('access_token').equal(application.access_token);
          done();
        });
      }
    ],
    function () {
      done();
    });
  });

  //TODO: add clone tests

  /* User manipulations */
  it('should create, get, modify and delete user', function (done) {
    var user = {user_name:"test_user", password:"s3cret", resource:"Resource", resource_id:"123"};

    async.series([
      function (done) {
        bclient.createUser(application.id, user, function (response) {
          user = response.content.data;

          user.should.have.property('access_token');
          user.should.have.property('user_name').equal('test_user');
          user.should.have.property('resource').equal("Resource");
          user.should.have.property('resource_id').equal("123");
          user.should.have.property('password').equal('s3cret');

          done();
        });
      },

      function (done) {
        bclient.getUser(application.id, user.user_name, function (response) {
          response.content.data.should.eql(user);
          done();
        });
      },

      function (done) {
        user.resource = "Resource_01";
        user.resource_id = "444";
        bclient.updateUser(application.id, user, function (response) {
          response.content.data.should.eql(user);
          done();
        });
      },

      function (done) {
        bclient.getUser(application.id, user.user_name, function (response) {
          response.content.data.should.eql(user);
          done();
        });
      },

      function (done) {
        bclient.deleteUser(application.id, user.user_name, function (response) {
          done();
        });
      }

    ], function () {
      done();
    });


  });

  /* Object type manipulations */
  it('should create, get, modify and delete object type', function (done) {
    var object_type = { name:'Resource_01'};

    async.series(
    [
      function (done) {
        bclient.createObjectType(application.id, object_type, function (response) {
          object_type = response.content.data;

          object_type.should.have.property('route_pattern').equal('/Resource_01/{id}/');
          object_type.should.have.property('id_field').equal('_id');

          done();
        })
      },

      function (done) {
        bclient.getObjectType(application.id, object_type.name, function (response) {

          object_type.should.have.property('name').equal('Resource_01');
          object_type.should.have.property('route_pattern').equal('/Resource_01/{id}/');
          object_type.should.have.property('id_field').equal('_id');

          done();
        });
      },

      function (done) {
        object_type.id_field = 'id';
        object_type.route_pattern = '/Resource/{id}/';
        var proxy_fun_code = 'function proxy() { return { mocked: true }; }';
        object_type.proxy_fun_code = proxy_fun_code
        bclient.updateObjectType(application.id, object_type, function (response) {
          object_type = response.content.data;
          object_type.should.have.property('id_field').equal('id');
          object_type.should.have.property('route_pattern').equal('/Resource/{id}/');
          object_type.should.have.property('proxy_fun_code').equal(proxy_fun_code);
          done();
        });
      },

      function (done) {
        bclient.deleteObjectType(application.id, object_type, function (response) {
          response.content.data.should.equal(true);
          done();
        });
      }
    ],
    function () {
      done();
    }
    );
  });


  /* Object instance manipulations */
  it('should create, get, modify and delete object instance', function (done) {

    var object_type = { name:"Resource_02", id_field:'id'};
    var resource = { id:1, value:"123"};

    async.series([
      function (done) {
        bclient.createObjectType(application.id, object_type, function (response) {
          done();
        });
      },

      function (done) {
        bclient.createResource(application.id, object_type.name, resource, function (response) {
          resource = response.content.data;

          resource.should.have.property('id').eql(1);
          resource.should.have.property('value').equal("123");
          done();
        });
      },

      function (done) {
        bclient.getResource(application.id, object_type.name, resource._id, function (response) {
          response.content.data.should.eql(resource);
          done();
        });
      },

      function (done) {
        resource.value = "444";
        resource.extra_field = true;
        bclient.updateResource(application.id, object_type.name, resource, function (response) {
          response.content.data.should.eql(resource);
          done();
        });
      },

      function (done) {
        bclient.deleteResource(application.id, object_type.name, resource._id, function (response) {
          response.content.data.should.have.property('removed').equal(true);
          done();
        });
      }
    ],
    function () {
      done();
    });
  });

  //TODO: same for event callbacks

});
