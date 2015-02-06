var dqmApp = angular.module('dqmApp', ['ngRoute', 'ui.bootstrap']);

dqmApp.controller('NavigationController', [
    '$scope', '$window', '$location', '$route', '$http', 'DynamicQuery',
    function($scope, $window, $location, $route, $http, DynamicQuery) {

    $scope.$route = $route;

    $scope.setPage = function (str) {
        $location.path("/" + str);
    };

    $scope.NavigationController = {};
    $scope.DynamicQuery = DynamicQuery;
    $scope.dqm_number = 2;

    $scope.toJson = function (v) {
        return angular.toJson(v, true);
    };

    $scope.reverse_log = function (s) {
        return s.split("\n").reverse().join("\n");
    };

    $scope.debug_object = function (c) {
        console.log("Debug object: ", c);
        return c;
    };

    $scope.alerts = [];

    $scope.addAlert = function(body) {
        $scope.alerts.push(body);
        $window.scrollTo(0, 0);
    };
    $scope.closeAlert = function(index) {
        $scope.alerts.splice(index, 1);
    };

    $scope.$watch(function () { return $http.pendingRequests.length; }, function (v) {
        $scope.NavigationController.http_count = v;
        $scope.NavigationController.http_state = v?"busy":"ready";
    });

    $scope.$watch('NavigationController.search_interval', function (x) {
        DynamicQuery.start(x);
    });
}]);

dqmApp.controller('ClusterCtrl', ['$scope', '$http', 'DynamicQuery', function($scope, $http, DynamicQuery) {
    var ctrl = {};
    $scope.ClusterCtrl = ctrl;

    // hostname
    $http.get("/").then(function (body) {
        var data = body.data;
        var host = data.name;
        ctrl.hostname = host;
    });

    var query = {
        "query": {
            "match_all": {}
        },
        "fields" : ["_timestamp"],
        "size": 1024,
        "sort": [
            { "type": { "order": "asc" }},
            { "_timestamp": { "order": "desc" }}
        ]
    };

    DynamicQuery.repeated_search_dct("info", {
        url: "/info",
        method: "get",
        _es_callback: function (body) {
            ctrl.info_data = body;
            console.log(ctrl, body);
        }
    });

    $scope.$on("$destroy", function handler() {
        DynamicQuery.delete_search("info");
    });
}]);

dqmApp.controller('StatsController', ['$scope', 'DynamicQuery', function($scope, DynamicQuery) {
    var ctrl = {};

    DynamicQuery.repeated_search("list-stats", "list/stats", null, function (body) {
        $scope.hits = body.hits;
        console.log(body);
        try {
            _.each($scope.hits, function (hit) {
                var pc = parseInt(hit.disk_used) * 100 / hit.disk_total;
                hit.$disk_pc = pc;

                if (hit._type == "dqm-diskspace") {
                    ctrl.lumi = hit.extra.files_seen;
                }
            });
        } catch (e) {
            console.log("Error", e);
        }
    });

    $scope.$on("$destroy", function handler() {
        DynamicQuery.delete_search("list-stats");
    });

    $scope.StatsCtrl = ctrl;
}]);

dqmApp.controller('LumiRunCtrl', ['$scope', 'DynamicQuery', function($scope, DynamicQuery) {
    DynamicQuery.repeated_search("list-runs", "list/runs", null, function (body) {
        var runs = _.uniq(body.runs);
        runs.sort();
        runs.reverse();

        $scope.runs = runs;
        $scope.runs_loaded = true;
    });

    $scope.$on("$destroy", function () {
        DynamicQuery.delete_search("list-runs");
    });
}]);

dqmApp.controller('LumiCtrl', ['$scope', '$http', 'DynamicQuery', '$location', '$routeParams', '$modal',
        function($scope, $http, DynamicQuery, $location, $routeParams, $modal) {

    var lumi = {
        run: $routeParams.run
    };

    lumi.set_run = function (v) {
        $location.path("/lumi/" + v + "/");
    };

    lumi.ec_hide = {};

    lumi.ec_toggle = function (c) {
        lumi.ec_hide[c] = !(lumi.ec_hide[c]);
    };

    $scope.$watch("LumiCtrl.run", function (v) {
        if (!v)
            return;

        DynamicQuery.repeated_search("lumi-data", "list/run/" + parseInt(v), null, function (body) {
            lumi.hits = body.hits;
            lumi.logs = {};

            // this block sorts the lumiSeen (originally, it's a dictionary,
            // but we want to see it as a list)
            try {
                _.each(lumi.hits, function (hit) {
                    var lines = [];
                    var ls = hit.extra.lumi_seen;
                    var skeys = _.keys(ls);
                    skeys.sort();

                    hit.$sortedLumi = _.map(skeys, function (key) {
                        // key is "lumi00032"
                        return "[" + key.substring(4) + "]: " + ls[key];
                    });

                    if (skeys.length) {
                        hit.$lastLumi = parseInt(skeys[skeys.length - 1].substring(4));
                    }
                });
            } catch (e) {
                console.log("Error", e);
            }

            // pick out the log entry
            // so it does not polute "source" button output
            _.each(lumi.hits, function (hit) {
                if (hit.extra && hit.extra.stdlog) {
                    var log = hit.extra.stdlog;
                    lumi.logs[hit._id] = log;

                    delete hit.extra.stdlog;
                }
            });

            // parse exit code
            try {
                var timestamps = [];
                _.each(lumi.hits, function (hit) {
                    // filter by exit code
                    var ec = hit.exit_code;

                    if ((ec === null) || (ec === undefined)) {
                        hit.$ec_class = "success";
                    } else if ((ec === 0) || (ec === "0")) {
                        hit.$ec_class = "warning";
                    } else {
                        hit.$ec_class = "danger";
                    }
                });
            } catch (e) {
                console.log("Error", e);
            }
        });

    });

    $scope.$on("$destroy", function () {
        DynamicQuery.delete_search("lumi-data");
    });

    lumi.openKillDialog = function (hit) {
        console.log("openining");
        var instance = $modal.open({
            templateUrl: 'lumiKillModal.html',
            controller: 'LumiKillDialogCtrl',
            scope: $scope,
            resolve: {
                data: function () {
                    return { hit: hit };
                }
            }
        });

        instance.result.then(function (ret) {
            var body = { pid: hit.pid, signal: ret.signal };
            var p = $http.post("/utils/kill_proc/" + hit._id, body);
            
            p.then(function (resp) {
                $scope.addAlert({ type: 'success', strong: "Success!", msg: resp.data });
            }, function (resp) {
                $scope.addAlert({ type: 'danger', strong: "Failure!", msg: resp.data });
            });
        }, function () {
            // aborted, do nothing
        });
    };

    $scope.LumiCtrl = lumi;
}]);

dqmApp.controller('LumiKillDialogCtrl', function ($scope, $modalInstance, data) {
    $scope.data = data;
})

dqmApp.factory('DynamicQuery', ['$http', '$window', function ($http, $window) {
    var factory = {
        base: "/",
        _searches: {},
        _ti: null
    };

    factory.repeated_search_dct = function (name, dct) {
        this._searches[name] = dct;
        this.do_the_query(dct);
    };

    factory.repeated_search = function (name, url, query, cb) {
        this.repeated_search_dct(name, {
            url: this.base + url,
            data: query,
            _es_callback: cb,
            method: "post",
        });
    };

    factory.delete_search = function (name) {
        delete this._searches[name];
    };

    factory.do_the_query = function (value) {
        var p = $http(value);
        p.success(value._es_callback);
    };

    factory.try_update = function () {
        if ($http.pendingRequests.length == 0) {
            angular.forEach(this._searches, this.do_the_query, this);
        };
    };

    factory.update_now = factory.try_update;

    factory.start = function (timeout_sec) {
        if (this._ti) {
            $window.clearInterval(this._ti);
            this._ti = null;
        }

        var ts = parseInt(timeout_sec) * 1000;
        if (ts) {
            this._ti = $window.setInterval(function () { factory.try_update(); }, ts);
        }

        console.log("Restarted watcher: " + ts);
    };

    return factory;
}]);

dqmApp.directive('prettifySource', function ($window) {
    return {
        restrict: 'A',
        scope: { 'prettifySource': '@' },
        link: function (scope, elm, attrs) {
            scope.$watch('prettifySource', function (v) {
                var lang = attrs.lang || "javascript";
                var x = hljs.highlight(lang, v || "") .value;
                elm.html(x);
            });
        }
    };
});

dqmApp.filter("dqm_megabytes", function() {
    return function(input) {
        var s = input || '';

        if (s.indexOf && s.indexOf(" kB") > -1) {
            s.replace(" kB", "");
            s = parseInt(s) * 1024;
        }

        s = (parseInt(s) / 1024 / 1024).toFixed(0) + ' ';
        s = s + "mb";

        return s;
    };
});

dqmApp.directive('dqmTimediffField', function ($window) {
    return {
        restrict: 'E',
        scope: { 'time': '=', 'diff': '=' },
        link: function (scope, elm, attrs) {
            var update = function () {
                if (! scope.time)
                    return;

                if (! scope.diff)
                    return;

                var diff_s = scope.diff - scope.time;

                scope.diff_s = diff_s;
                if (diff_s < 60) {
                    scope.diff_class = "label-success";
                } else if (diff_s < 60*5) {
                    scope.diff_class = "label-info";
                } else if (diff_s < 60*10) {
                    scope.diff_class = "label-warning";
                } else {
                    scope.diff_class = "label-danger";
                };
            }

            scope.$watch('time', update);
            scope.$watch('diff', update);
            update();
        },
        template: '<span class="label label-success" ng-class="diff_class">{{ diff_s | number:0 }}&nbsp;s.</span>'
    };
});

dqmApp.directive('dqmMemoryGraph', function ($window) {
    // the "drawing" code is taken from http://bl.ocks.org/mbostock/4063423
    var d3 = $window.d3;

    return {
        restrict: 'E',
        scope: { 'data': '=', 'width': '@', 'height': '@' },
        link: function (scope, elm, attrs) {
            var width = parseInt(scope.width);
            var height = parseInt(scope.height);

            var div = d3.select(elm[0]).append("div");
            div.attr("style", "position: relative");

            var svg = div.append("svg");
            svg.attr("width", width).attr("height", height);

            var chart = nv.models.lineChart()
                .margin({left: 100})
                .useInteractiveGuideline(false)
                .showLegend(true)
                .transitionDuration(350)
                .showYAxis(true)
                .showXAxis(true)
                .xScale(d3.time.scale());
            ;

            console.log("chart", chart);

            chart.interactiveLayer.tooltip.enabled(false);
            chart.interactiveLayer.tooltip.position({"left": 0, "top": 0});

            chart.xAxis
                .axisLabel('Time')
                .tickFormat(d3.time.format('%X'));

            chart.yAxis
                .axisLabel('Mem (mb)')
                .tickFormat(d3.format('.02f'));

            scope.$watch("data", function (data) {
                if (!data)
                    return;

                // unpack the data
                // we get "timestamp" -> "statm"
                var keys = _.keys(data);
                keys.sort()

                // this is the content labels
                // from /proc/<pid>/statm
                // it's in pages, so we convert to megabytes
                var labels = ["size", "resident", "share", "text", "lib", "data", "dt"];
                var displayed = {"size": 1, "resident": 1 };
                var streams = {};

                _.each(labels, function (l) {
                    var d = (displayed[l] === undefined);
                    streams[l] = { key: l, values: [], disabled: d };
                });

                _.each(keys, function (key) {
                    var time = new Date(parseInt(key)*1000);

                    var unpacked = data[key].split(" ");
                    _.each(unpacked, function (v, index) {
                        var l = labels[index];
                        streams[l].values.push({
                            'y': parseFloat(v) * 4 / 1024,
                            'x': time,
                        });
                    });
                });

                var display = _.values(streams);
                svg
                    .datum(display)
                    .transition().duration(500)
                    .call(chart)
                ;
            });
        }
    };
});


dqmApp.directive('dqmLumiGraph', function ($window) {
    // the "drawing" code is taken from http://bl.ocks.org/mbostock/4063423
    var d3 = $window.d3;

    return {
        restrict: 'E',
        scope: { 'lumi': '=', 'width': '@', 'height': '@' },
        link: function (scope, elm, attrs) {
            var width = parseInt(scope.width);
            var height = parseInt(scope.height);
            var radius = Math.min(width, height) / 2;
            var color = d3.scale.category20c();

            var svg = d3.select(elm[0]).append("svg");
            svg.attr("width", width).attr("height", height);

            var g = svg.append("g");
            g.attr("transform", "scale(" + width / 800 + "," + height / 600 + ")");

            g.append("line")
                .attr("x1", 0).attr("x2", 0)
                .attr("y1", 0).attr("y2", 100)
                .attr("stroke-width", 2)
                .attr("stroke", "black");

            //console.log([2 * Math.PI, radius * radius]);

            //var partition = d3.layout.partition()
            //    .sort(null)
            //    .size([2 * Math.PI, radius * radius])
            //    .value(function(d) { console.log('access', d); return 1; });

            //var arc = d3.svg.arc()
            //    .startAngle(function(d) { return d.x; })
            //    .endAngle(function(d) { return d.x + d.dx; })
            //    .innerRadius(function(d) { return Math.sqrt(d.y); })
            //    .outerRadius(function(d) { return Math.sqrt(d.y + d.dy); });

            //var arcTween = function(a) {
            //    console.log("a", a);
            //    var i = d3.interpolate({x: a.x0, dx: a.dx0}, a);

            //    return function(t) {
            //      var b = i(t);
            //      a.x0 = b.x;
            //      a.dx0 = b.dx;
            //      return arc(b);
            //    };
            //}

            var unpack_streams = function (lumi) {
                var keys = _.keys(lumi);
                return _.map(lumi, function (lst, name) {
                    var obj = {
                        'name': name,
                        'lumi': [],
                        'size': [],
                        'ts': [],
                    };

                    _.map(lst, function (x) {
                        var splits = x.split(":");
                        var tags = splits[1].split(" ");

                        splits = splits[0].split(" ");
                        obj.lumi.push(parseInt(splits[0]));
                        obj.size.push(parseInt(splits[1]));
                        obj.ts.push(parseFloat(splits[2]));
                    });

                    return obj;
                });

            };

            scope.$watch('lumi', function (lumi) {
                if (!lumi) return;

                lumi = unpack_streams(lumi);
                console.log('new data', lumi);
    
                //g.selectAll("g").data(keys).enter().append('g').each(function (x) {
                //  var packed = lumi[x];
                //  var elm = d3.select(this);
                //  var perLumi = (Math.PI*2) / 100;

                //  var data = _.map(packed, function (x) {
                //      var splits = x.split(":");
                //      var tags = splits[1].split(" ");
                //      console.log(splits, tags);

                //      splits = splits[0].split(" ");
                //      var lumi = parseInt(splits[0]);
                //      var size = parseInt(splits[1]);
                //      var ts = parseFloat(splits[2]);

                //      return [lumi, size, ts];
                //  });
    
                //  console.log(data, perLumi);
                //  var startAngle = function (x) {


                //  };

                //  elm.selectAll("path")
                //      .data(data)
                //      .enter().append("svg:path")
                //      .attr("d", d3.svg.arc()
                //          .innerRadius(radius / 4)
                //          .outerRadius(radius / 3)
                //          .startAngle(startAngle)
                //          .endAngle(function (x) { return startAngle(x) + perLumi; })
                //      )
                //      .style("fill", function(d, i) { return color(i); });
                //});

                //svg.selectAll("path")
                //  .data(d3.layout.pie())
                //  .enter().append("svg:path")
                //  .attr("d", d3.svg.arc()
                //  .innerRadius(r / 2)
                //  .outerRadius(r))
                //  .style("fill", function(d) { return color(1); });


                //var path = svg.datum(lumi).selectAll("path")
                //    .data(partition.nodes)
                //    .enter().append("path")
                //    .attr("display", function(d) { return d.depth ? null : "none"; }) // hide inner ring
                //    .attr("d", arc)
                //    .style("stroke", "#fff")
                //    .style("fill", function(d) { console.log('x', d); return color(2); })
                //    .style("fill-rule", "evenodd");

                //path
                //    .data(partition..nodes)
                //    .transition()
                //    .duration(1500)
                //    .attrTween("d", arcTween);

                //D3.selectAll("input").on("change", function change() {
                //    var value = this.value === "count"
                //      ? function() { return 1; }
                //      : function(d) { return d.size; };

                //    path
                //        .data(partition.value(value).nodes)
                //        .transition()
                //        .duration(1500)
                //        .attrTween("d", arcTween);
                //});

            });
        },
    };
});


dqmApp.config(function($routeProvider, $locationProvider) {
  $routeProvider
    .when('/lumi/', { menu: 'lumi', templateUrl: 'templates/lumi.html' })
    .when('/stats/', { menu: 'stats', templateUrl: 'templates/stats.html' })
    .when('/lumi/:run/', { menu: 'lumi', templateUrl: 'templates/lumi.html' })
    .otherwise({ redirectTo: '/lumi' });

  // configure html5 to get links working on jsfiddle
  $locationProvider.html5Mode(false);
});