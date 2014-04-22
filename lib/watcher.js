var _ = require('lodash');
var Etcd = require('node-etcd');
var util = require('util');
var q = require('q');
var logger = require('logsimple');
var fs = require('fs');
var path = require('path');
var exec = require('child_process').exec;
var async = require('async');

var haproxyNodeTemplate = _.template(fs.readFileSync(path.normalize(__dirname + '/templates/haproxy')).toString());

// specify the cluster to connect to
var PROXY_WATCHER_ETCD_CLUSTER_HOST = process.env.PROXY_WATCHER_ETCD_CLUSTER_HOST || '127.0.0.1';
var PROXY_WATCHER_ETCD_CLUSTER_PORT = process.env.PROXY_WATCHER_ETCD_CLUSTER_PORT || '4001';

// specify the path to listen on
var PROXY_WATCHER_ETCD_PATH = process.env.PROXY_WATCHER_ETCD_PATH;

// path to stick the compiled version of the 
var PROXY_WATCHER_CONFIG_PATH =  process.env.PROXY_WATCHER_CONFIG_PATH;

var PROXY_WATCHER_RELOAD_COMMAND = process.env.PROXY_WATCHER_RELOAD_COMMAND;

var TEMPLATE = process.argv[2];

var proxyConfigTemplate = _.template(fs.readFileSync(path.normalize(TEMPLATE)).toString());


// Check to make sure everything is set
if(!PROXY_WATCHER_ETCD_PATH){
	logger.error('args', 'Please set environment variable PROXY_WATCHER_ETCD_PATH');
	process.exit(1);
}

if(!PROXY_WATCHER_CONFIG_PATH){
	logger.error('args', 'Please set environment variable PROXY_WATCHER_CONFIG_PATH');
	process.exit(1);
}

if(!PROXY_WATCHER_RELOAD_COMMAND){
	logger.error('args', 'Please set environment variable PROXY_WATCHER_RELOAD_COMMAND');
	process.exit(1);
}

if(process.argv[0] == 'node' && !process.argv[2]){
	console.log('useage: node proxy-watcher config.template');
	process.exit(1);
}

if(process.argv[0] != 'node' && !process.argv[1]){
	console.log('useage: proxy-watcher config.template');
	process.exit(1);
}

var etcd = new Etcd(PROXY_WATCHER_ETCD_CLUSTER_HOST, PROXY_WATCHER_ETCD_CLUSTER_PORT);


var watchForChanges = function(){
	var updateQueue = async.queue(function(task, cb){
		if(task && task.update){
			logger.infoGrey('queue', 'processing queue job');
			return task.update()
				.then(function(){
					cb();
				})
				.fail(function(){
					cb();
				});
		} else {
			cb();
		}
	}, 1);

	updateQueue.drain = function(){
		logger.infoGrey('queue', 'queue drained');
	};

	var watcher = etcd.watcher(PROXY_WATCHER_ETCD_PATH, null, { recursive: true });
	logger.infoGrey('watcher', 'now watching ' + PROXY_WATCHER_ETCD_PATH + ' for changes');
	watcher.on('change', function(modifiedNode){
		var newVal = modifiedNode.node;
		var oldVal = modifiedNode.prevNode;

		var hasChanged = false;
		if(newVal && !oldVal){
			hasChanged = true;
		} else {
			_.each(newVal, function(val, key){
				if(key == 'value'){

					var oldJson;
					var newJson;

					try {
						oldJson = JSON.parse(oldVal[key]);
						newJson = JSON.parse(val);
					} catch(e){};

					if(!oldJson || !newJson){
						hasChanged = true;
						return;
					}

					_.each(newJson, function(v, k){
						if(oldJson[k] != v){
							hasChanged = true;
						}
					});

				} else {
					if(oldVal[key] != val){
						hasChanged = true;
					}
				}
			});
		}

		if(hasChanged){
			logger.infoYellow('watcher', 'node value changed', modifiedNode);
			updateQueue.push({
				update: fetchAndReloadNodes
			});
		} else {
			logger.infoGrey('watcher', 'node set, but not changed');
		}
	});
};

var fetchAndReloadNodes = function(){
	logger.infoGrey('fetch', 'fetching nodes...');
	var deferred = q.defer();

	etcd.get(PROXY_WATCHER_ETCD_PATH, { recursive: true }, function(err, node){
		if(err){
			logger.infoYellow('seed', 'Error seeding', err);
			return deferred.resolve();
		}
		var jsonNodes = [];
		
		(function(){
			if(node && node.node && node.node.nodes){
				_.each(node.node.nodes, function(service){
					var json;
					try {
						json = JSON.parse(service.value);
					} catch(e){}

					if(json){
						jsonNodes.push(json);
					}
				});

				return q.resolve(jsonNodes);
			} else {
				return q.resolve([]);
			}
		})()
			.then(function(nodes){
				return buildAndReloadConfig(nodes)
					.then(function(){
						deferred.resolve();
					})
					.fail(function(){
						deferred.reject();
					});
			});
	});

	return deferred.promise;
};

/*
	Take a list of nodes and rebuild the config
	[{
		host: <hostname>,
		port: <port>
	}]
*/
var buildAndReloadConfig = function(nodes){
	var renderedConfig = proxyConfigTemplate({
		nodes: haproxyNodeTemplate({ nodes: nodes })
	});

	var deferred = q.defer();
	fs.writeFile(PROXY_WATCHER_CONFIG_PATH, renderedConfig, function(err){
		if(err){
			logger.error('config', 'error writing out config', err);
			return deferred.reject(err);
		}

		child = exec(PROXY_WATCHER_RELOAD_COMMAND, function(err, stdout, stderr){
			if(err){
				logger.error('reload', 'reloading', err);
				return deferred.reject(err);
			}

			logger.success('reload', 'proxy reloaded');
			return deferred.resolve();
		});
	});
	return deferred.promise;
};

fetchAndReloadNodes()
	.then(function(){
		watchForChanges();
	})
	.fail(function(err){
		logger.error('', err);
	});