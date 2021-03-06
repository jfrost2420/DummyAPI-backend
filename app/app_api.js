/**
 *  app_api.js
 *
 *  application API implementation
 *
 *  Author: Sergey Chernov (chernser@outlook.com)
 */
var AppApi = module.exports.AppApi = function (app_storage) {

    var express = require('express')
        , socket_io = require('socket.io')
        , config = require('../config')
        , _ = require('underscore')
        , api = this
        , app = null;

    this.app = app = express.createServer();
    this.app_storage = app_storage;
    this.config = config;

    // Configuration
    app.configure(function () {
        app.use(express.bodyParser());
        app.use(express.static(__dirname + '/../public/'));
    });

    app.configure('development', function () {
        app.use(express.errorHandler({ dumpExceptions:true, showStack:true }));
    });

    app.configure('production', function () {
        app.use(express.errorHandler());
    });


    // Socket.IO

    this.io = socket_io.listen(app);

    api.io.configure(function () {
        api.io.set('authorization', function (handshakeData, callback) {
            api.getApplicationIdFromReq(handshakeData.headers, handshakeData.query, function (err, app_id) {
                if (err != null) {
                    callback(null, false);
                } else {
                    handshakeData.app_id = app_id;
                    callback(null, true); // error first callback style
                }
            });
        });
    });

    this.io.on('connection', function (socket) {

        api.addClientSocket(socket);

        socket.on('disconnect', function () {
            api.delClientSocket(socket);
        });
    });


    // Express.JS
    var ALLOWED_HEADERS = 'Content-Type, X-Parse-REST-API-Key, X-Parse-Application-Id, ' +
        'Access-Token';

    app.options('*', function (req, res) {
        res.header('Access-Control-Allow-Origin', '*');
        res.header('Access-Control-Allow-Credentials', true);
        res.header('Access-Control-Allow-Methods', 'POST, GET, PUT, DELTE, OPTIONS');
        res.header('Access-Control-Allow-Headers', ALLOWED_HEADERS);

        // TODO: move custom fields to configuration

        res.send(200);
    });


    var API_PATTERN = /^\/api\/1\/+((\w+\/?)+)/;

    var getDefaultCallback = function (res) {
        return function (err, object) {
            if (err !== null) {
                res.send(err);
            } else {
                if (object !== null) {
                    res.json(object);
                } else {
                    res.send(404);
                }
            }
        };
    };

    var getApplicationIdMiddleware = function (req, res, next) {
        api.getApplicationIdFromReq(req.headers, req.query, function (err, app_id) {
            if (err == 'not_found') {
                res.send(400);
            } else if (err != null) {
                res.send(500, err);
            } else {
                req.app_id = app_id;
                next();
            }
        });
    };

    var getUserMiddleware = function (req, res, next) {
        var user_token = req.query.user_token;
        if (typeof user_token != 'string') {
            user_token = req.get('User-Access-Token');
        }


        if (typeof user_token == 'string' && user_token != '') {
            console.log("user token: ", user_token);
            api.app_storage.getUserByAccessToken(user_token, function (err, user) {
                if (err != null) {
                    res.send(500, err);
                    return;
                }

                console.log('>> user name: ', user);
                req.user_groups = user.hasOwnProperty('groups') ? user.groups : [];

                next();
            });

        } else {
            req.user_groups = [];
            next();
        }
    };

    var addHeadersMiddleware = function (req, res, next) {

        res.header('Access-Control-Allow-Origin', '*');
        next();
    };

    var middlewares = [getApplicationIdMiddleware, getUserMiddleware, addHeadersMiddleware];

    app.get('/api/1/', middlewares, function (req, res) {
        app_storage.getApplication(req.app_id, function (err, application) {

            var api_def = {
                app_id:application.id,
                app_name:application.name,

                resources:[]
            };

            for (var i in application.objtypes) {
                var objType = application.objtypes[i];
                var baseUrl = '/api/' + objType.name;

                api_def._resources.push({
                    ref:objType.name,
                    url:baseUrl
                });

                api_def['create_' + objType.name] = {rel:"create", url:baseUrl};
            }

            res.json(api_def);
        });
    });

    // Authentication

    // TODO: rename auth_middlewares to something more suitable
    var auth_middlewares = [getApplicationIdMiddleware, addHeadersMiddleware];
    app.post('/api/1/simple_token_auth', auth_middlewares, function (req, res) {

        var credentials = req.body;
        console.log("credentials: ", credentials, req.header('Access-Token'));
        if (credentials == null || typeof credentials.user_name != 'string' ||
            typeof credentials.password != 'string') {
            res.send(400);
            return;
        }

        app_storage.getUserByName(req.app_id, credentials.user_name, function (err, user) {
            if (err != null) {
                res.send(500, err);
                return;
            }

            if (user == null || user.password != credentials.password) {
                res.send(400, 'invalid credentials');
                return;
            }

            var response = {
                access_token:user.access_token,
                user_id:user.id
            };

            if (typeof credentials.token_cookie == 'string') {
                // TODO: add cookie options
                res.cookie(credentials.token_cookie, user.access_token, {});
            }

            // TODO: make configurable
            res.cookie('session', user.access_token);
            res.cookie('user_id', user.id);
            res.json(response);
        });

    });

    app.get('/api/1/ugly_get_auth', auth_middlewares, function (req, res) {
        var user_name = req.query.username;
        var password = req.query.password;

        if (typeof user_name != 'string' || typeof password != 'string') {
            res.send(400, "invalid parameters");
            return;
        }

        app_storage.getUserByName(req.app_id, user_name, function (err, user) {
            if (err != null) {
                console.log(err);
                res.send(500, err);
                return;
            }

            if (user == null || user.password != password) {
                console.log(">>", user_name, password);
                res.send(400);
                return;
            }

            var resource = _.isEmpty(user.resource) ? req.query.resource : user.resource;
            var resource_id = _.isEmpty(user.resource_id) ? req.query.resource_id: user.resource_id;

            if (_.isUndefined(resource_id)) {
                resource_id = user.id;
            }

            if (typeof resource != 'string' || resource == '') {
                // TODO: make configurable
                res.cookie('session', user.access_token, {path: "/"});
                res.cookie('user_id', user.id, {path: "/"});

                res.json(user);
            } else {
                // TODO: move to separate function
                app_storage.getObjectType(req.app_id, resource, function (err, object_type) {
                    if (err != null || object_type == null) {
                        console.log(err, resource);
                        res.send(500);
                        return;
                    }

                    var id = {id:resource_id, id_field:object_type.id_field};
                    app_storage.getObjectInstances(req.app_id, resource, id, function (err, resources) {
                        if (err != null) {
                            console.log(err);
                            res.send(500);
                            return;
                        }

                        if (resources == null || resources.length == 0) {
                            res.send(404);
                        } else {
                            // TODO: make configurable
                            res.cookie('session', user.access_token);
                            res.cookie('user_id', user.id);
                            res.json(resources[0]);
                        }
                    });
                });
            }
        });
    });


    // Sockte.IO notifications
    app.post('/api/1/socket/event', middlewares, function (req, res) {
        var event = req.body;
        var notified = api.notifyApplicationClients(req.app_id, event);
        res.json({notified_clients:notified});
    });


    // Resource manipulations (keep them last)
    app.get(API_PATTERN, middlewares, function (req, res) {
        api.handleGet(req.app_id, req.params[0], getDefaultCallback(res));
    });

    app.post(API_PATTERN, middlewares, function (req, res) {
        api.handlePost(req.app_id, req.params[0], req.body, getDefaultCallback(res));
    });

    app.put(API_PATTERN, middlewares, function (req, res) {
        api.handlePut(req.app_id, req.params[0], req.body, getDefaultCallback(res));
    });

    app.delete(API_PATTERN, middlewares, function (req, res) {
        api.handleDelete(req.app_id, req.params[0], getDefaultCallback(res));
    });

    return this;
};

AppApi.prototype.DEFAULT_RESOURCE_PROXY = function (resource) {
    return resource;
};


AppApi.prototype.start = function () {
    var app = this.app;
    app.listen(this.config.app_api.port, function () {
        console.log("AppAPI listening on port %d in %s mode", app.address().port, app.settings.env);
    });
};

AppApi.prototype.stop = function () {
    var app = this.app;
    app.close();
};


AppApi.prototype.getApplicationIdFromReq = function (headers, query, callback) {
    var api = this;
    var access_token = query.access_token;
    if (typeof access_token != 'string') {
        // TODO: improve
        access_token = headers['access-token'];
    }

    if (typeof access_token != 'string' || access_token == '') {
        callback('not_found', null);
    } else {
        api.app_storage.getAppIdByAccessToken(access_token, function (err, app_id) {
            if (err != null) {
                callback(err, null);
                return;
            }

            callback(null, app_id);
        });
    }
}


AppApi.prototype.getObjectTypeByRoute = function (app_id, route_pattern, callback) {
    this.app_storage.getObjectTypeByRoute(app_id, route_pattern, function (err, objectType) {
        if (err == 'not_found') {
            callback(404, null);
            return;
        }

        callback(null, objectType);
    });
};

function getProxy(objectType, defaultProxy) {
    if (typeof objectType.proxy_fun_code != 'undefined') {
        var eval_result = eval(objectType.proxy_fun_code);
        if (typeof proxy == 'undefined') {
            return defaultProxy;
        }
        return proxy;
    } else {
        return defaultProxy;
    }
}

function getObjectId(id, objectType) {
    if (typeof id !== 'undefined' && id !== null && id !== '') {
        return typeof objectType.id_field != 'undefined' ? {id_field:objectType.id_field, id:id} : id;
    } else {
        return null;
    }
}

function getRouteInfoFromUrl(url) {
    var parts = url.split('/');
    var routePattern = "/";
    var part_index = 0;
    var no_of_parts = parts.length;
    var id = null;

    while (part_index < no_of_parts && parts[part_index] !== '') {
        // Resource name
        routePattern += parts[part_index] + "/";

        // Resource id
        part_index += 1;
        if (part_index < no_of_parts && parts[part_index] !== '') {
            id = parts[part_index];
        } else {
            id = null;
        }
        routePattern += "{id}/";

        // Next pair
        part_index += 1;
    }

    return {route_pattern:routePattern, id:id};
}

AppApi.prototype.handleGet = function (app_id, url, callback) {
    var api = this;
    var route_info = getRouteInfoFromUrl(url);
    var route_pattern = route_info.route_pattern;
    var id = route_info.id;
    api.getObjectTypeByRoute(app_id, route_pattern, function (err, objectType) {
        if (err !== null) {
            callback(err, null);
            return;
        }
        var proxy = getProxy(objectType, api.DEFAULT_RESOURCE_PROXY);
        id = getObjectId(id, objectType);
        api.app_storage.getObjectInstances(app_id, objectType.name, id, function (err, resources) {
            if (typeof resources != 'undefined' && resources !== null && resources.length >= 0) {
                if (id === null) {
                    var response = [];
                    for (var index in resources) {
                        response.push(proxy(resources[index]));
                    }
                    callback(null, response);
                } else {
                    callback(null, proxy(resources[0]));
                }
            } else {
                callback(null, null);
            }
        });
    });
};

AppApi.prototype.handlePut = function (app_id, url, instance, callback) {
    var api = this;
    var route_info = getRouteInfoFromUrl(url);
    var route_pattern = route_info.route_pattern;
    var id = route_info.id;

    api.getObjectTypeByRoute(app_id, route_pattern, function (err, objectType) {
        if (err !== null) {
            callback(err, null);
            return;
        }

        var proxy = getProxy(objectType, api.DEFAULT_RESOURCE_PROXY);
        id = getObjectId(id, objectType);
        api.app_storage.saveObjectInstance(app_id, objectType.name, id, instance, function (err, saved) {
            var resource = proxy(saved);
            api.notifyResourceChanged(app_id, saved);
            callback(null, resource);
        });
    });
};

AppApi.prototype.handlePost = function (app_id, url, instance, callback) {
    var api = this;
    var route_info = getRouteInfoFromUrl(url);
    var route_pattern = route_info.route_pattern;

    api.getObjectTypeByRoute(app_id, route_pattern, function (err, objectType) {
        if (err !== null) {
            callback(err, null);
            return;
        }

        var proxy = getProxy(objectType, api.DEFAULT_RESOURCE_PROXY);

        api.app_storage.addObjectInstace(app_id, objectType.name, instance, function (err, saved) {
            api.notifyResourceCreated(app_id, saved);
            callback(err, proxy(saved));
        });
    });
};

AppApi.prototype.handleDelete = function (app_id, url, callback) {
    var api = this;
    var route_info = getRouteInfoFromUrl(url);
    var route_pattern = route_info.route_pattern;
    var id = route_info.id;

    api.getObjectTypeByRoute(app_id, route_pattern, function (err, objectType) {
        if (err !== null) {
            callback(err, null);
            return;
        }
        id = getObjectId(id, objectType);
        api.app_storage.deleteObjectInstance(app_id, objectType.name, id, function () {
            api.notifyResourceDeleted({id: id, object_type: objectType.name});
            callback(null, null);
        });
    });
};


function DEFAULT_NOTIFY_PROXY(event, resource) {
    event.data = resource;
    return event;
}

function getNotifyProxy(application) {
    if (typeof application.notify_proxy_fun != 'undefined') {
        try {
            eval(application.notify_proxy_fun);
            return proxy;
        } catch (e) {
            console.log("Error: failed to eval notify proxy function: ", e.toString(), e);
        }
    }

    return DEFAULT_NOTIFY_PROXY;
}


// Notifications
AppApi.prototype.app_client_sockets = {};

AppApi.prototype.addClientSocket = function(socket) {

    // register client
    var app_id = socket.handshake.app_id;
    var sockets = this.app_client_sockets[app_id];
    if (typeof sockets == 'undefined' || sockets == null) {
        this.app_client_sockets[app_id] = sockets = [];
    }

    sockets.push(socket);

    console.log('application ', app_id, ' client registered socket');
};

AppApi.prototype.delClientSocket = function(socket) {
    // un-register client
    var app_id = socket.handshake.app_id;
    var sockets = this.app_client_sockets[app_id];
    if (typeof sockets != 'undefined' || sockets != null) {
        for (var index in sockets) {
            if (sockets[index] == socket) {
                console.log("Disconnected client found. Remove");
                delete this.app_client_sockets[app_id][index];
                break;
            }
        }
    }
};

AppApi.prototype.notifyApplicationClients = function(app_id, event) {

    var sockets = this.app_client_sockets[app_id];
    if (typeof sockets == 'undefined') {
        sockets = [];
    }

    var notified = 0;
    for (var index in sockets) {
        sockets[index].emit(event.name, event.data);
        ++notified;
    }

    return notified;
};

AppApi.prototype.send_event = function (app_id, eventName, eventData, callback) {
    var api = this;

    api.app_storage.getApplication(app_id, function (err, application) {
        var proxy = getNotifyProxy(application);
        var event = proxy({name:eventName, type:'event'}, eventData);

        var result = api.notifyApplicationClients(app_id, event);
        if (typeof callback == 'function') {
            callback(null, {notified: result});
        }
    });
};

AppApi.prototype.notifyResourceChanged = function (app_id, resource) {
    this.send_event(app_id, 'resource_updated', resource);
};

AppApi.prototype.notifyResourceCreated = function (app_id, resource) {
    this.send_event(app_id, 'resource_created', resource);
};

AppApi.prototype.notifyResourceDeleted = function (app_id, resource) {
    this.send_event(app_id, 'resource_deleted', resource);
};